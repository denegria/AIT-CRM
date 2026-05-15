import { Client } from 'pg';

const EXPECTED_ROLE_PERMISSIONS = {
  admin: [
    'business_units:all',
    'crm:read',
    'crm:write',
    'financials:read',
    'financials:write',
    'import_review:read',
    'import_review:write',
    'reports:read',
    'settings:read',
    'settings:write',
    'work_orders:write',
  ],
  account_manager: ['crm:read', 'crm:write', 'financials:read'],
  designer: ['crm:read', 'work_orders:write'],
  sales_manager: ['crm:read', 'crm:write', 'financials:read', 'reports:read'],
};

const FORBIDDEN_NON_ADMIN_PERMISSIONS = new Set([
  'business_units:all',
  'financials:write',
  'import_review:read',
  'import_review:write',
  'settings:read',
  'settings:write',
]);

const checks = [];

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail: detail || '' });
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? ' - ' + detail : '';
  console.log(status + ' ' + name + suffix);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + ' is required.');
  return value;
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function diff(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await readJson(response);
  return { response, body };
}

async function checkDatabaseBoundaries(client) {
  const roleResult = await client.query(
    'select r.key as role_key, p.key as permission_key ' +
      'from roles r ' +
      'left join role_permissions rp on rp.role_id = r.id ' +
      'left join permissions p on p.id = rp.permission_id ' +
      'order by r.key asc, p.key asc',
  );

  const permissionsByRole = new Map();
  for (const row of roleResult.rows) {
    if (!permissionsByRole.has(row.role_key)) permissionsByRole.set(row.role_key, []);
    if (row.permission_key) permissionsByRole.get(row.role_key).push(row.permission_key);
  }

  for (const [roleKey, expected] of Object.entries(EXPECTED_ROLE_PERMISSIONS)) {
    const actual = sortedUnique(permissionsByRole.get(roleKey) || []);
    const expectedSorted = sortedUnique(expected);
    const missing = diff(expectedSorted, actual);
    const extra = diff(actual, expectedSorted);
    addCheck(
      'role ' + roleKey + ' permission set',
      missing.length === 0 && extra.length === 0,
      'expected=' + expectedSorted.join(',') + ' actual=' + actual.join(','),
    );
  }

  const forbiddenRows = await client.query(
    'select r.key as role_key, p.key as permission_key ' +
      'from roles r ' +
      'join role_permissions rp on rp.role_id = r.id ' +
      'join permissions p on p.id = rp.permission_id ' +
      'where r.key <> $1 ' +
      'order by r.key asc, p.key asc',
    ['admin'],
  );
  const forbidden = forbiddenRows.rows.filter((row) => FORBIDDEN_NON_ADMIN_PERMISSIONS.has(row.permission_key));
  addCheck(
    'non-admin roles do not have admin/recovery permissions',
    forbidden.length === 0,
    forbidden.map((row) => row.role_key + ':' + row.permission_key).join(', '),
  );

  const scopedUsers = await client.query(
    'select u.email, array_agg(distinct r.key order by r.key) as role_keys, count(distinct bum.business_unit_id)::int as membership_count ' +
      'from users u ' +
      'join user_roles ur on ur.user_id = u.id ' +
      'join roles r on r.id = ur.role_id ' +
      'left join business_unit_memberships bum on bum.user_id = u.id ' +
      'where u.is_active = true ' +
      'group by u.email ' +
      'order by u.email asc',
  );
  const missingMemberships = scopedUsers.rows.filter((row) => {
    const roles = row.role_keys || [];
    return !roles.includes('admin') && Number(row.membership_count) < 1;
  });
  addCheck(
    'active non-admin users have at least one business-unit membership',
    missingMemberships.length === 0,
    missingMemberships.map((row) => row.email).join(', '),
  );
}

async function checkHttpBoundaries() {
  const baseUrl = process.env.AIT_CRM_BASE_URL;
  const email = process.env.AIT_CRM_RBAC_TEST_EMAIL;
  const password = process.env.AIT_CRM_RBAC_TEST_PASSWORD;
  if (!baseUrl || !email || !password) {
    addCheck(
      'HTTP RBAC smoke skipped',
      true,
      'set AIT_CRM_BASE_URL, AIT_CRM_RBAC_TEST_EMAIL, and AIT_CRM_RBAC_TEST_PASSWORD to run it',
    );
    return;
  }

  const login = await requestJson(new URL('/api/auth/login', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  addCheck('test account login succeeds', login.response.ok, 'status=' + login.response.status);
  if (!login.response.ok) return;

  const cookieHeader = login.response.headers.get('set-cookie') || '';
  const sessionCookie = cookieHeader.split(';')[0];
  addCheck('login returned session cookie', Boolean(sessionCookie), sessionCookie ? 'cookie present' : 'missing cookie');
  if (!sessionCookie) return;

  const session = await requestJson(new URL('/api/auth/session', baseUrl), {
    headers: { cookie: sessionCookie },
  });
  const user = session.body.user || {};
  const permissions = user.permissions || [];
  addCheck('test account is business-unit scoped', user.canAccessAllBusinessUnits === false, 'canAccessAllBusinessUnits=' + user.canAccessAllBusinessUnits);
  addCheck('test account has assigned business unit', Array.isArray(user.businessUnitIds) && user.businessUnitIds.length > 0, (user.businessUnitIds || []).join(','));
  addCheck('test account cannot read import review', !permissions.includes('import_review:read'), 'permissions=' + permissions.join(','));

  const users = await requestJson(new URL('/api/users', baseUrl), {
    headers: { cookie: sessionCookie },
  });
  addCheck('test account cannot access user administration API', users.response.status === 403, 'status=' + users.response.status);

  const importReview = await requestJson(new URL('/api/import-review?status=pending&type=all&limit=1', baseUrl), {
    headers: { cookie: sessionCookie },
  });
  addCheck(
    'test account cannot access import recovery queue',
    importReview.response.status === 401 || importReview.response.status === 403,
    'status=' + importReview.response.status,
  );
}

async function main() {
  const client = new Client({ connectionString: requiredEnv('DATABASE_URL') });
  await client.connect();
  try {
    await checkDatabaseBoundaries(client);
  } finally {
    await client.end();
  }

  await checkHttpBoundaries();

  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    console.error('');
    console.error(failed.length + ' RBAC boundary check(s) failed.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
