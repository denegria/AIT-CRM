import { pbkdf2Sync, randomBytes } from 'crypto';
import { Client } from 'pg';

const PASSWORD_ITERATIONS = 310000;

const PERMISSIONS = {
  admin: [
    'crm:read',
    'crm:write',
    'import_review:read',
    'import_review:write',
    'settings:read',
    'settings:write',
    'reports:read',
    'financials:read',
    'financials:write',
    'work_orders:write',
    'business_units:all',
  ],
  designer: ['crm:read', 'work_orders:write'],
  account_manager: ['crm:read', 'crm:write', 'financials:read', 'financials:write', 'work_orders:write'],
  senior_coordinator: ['crm:read', 'crm:write', 'financials:read', 'financials:write', 'work_orders:write'],
  sales_manager: ['crm:read', 'crm:write', 'reports:read', 'financials:read'],
};

const ROLE_NAMES = {
  admin: 'Administrator',
  designer: 'Designer',
  account_manager: 'Account Coordinator',
  senior_coordinator: 'Senior Coordinator',
  sales_manager: 'Sales Manager',
};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function firstDefinedEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 64, 'sha512').toString('base64');
  return { hash, salt };
}

async function ensureOrganization(client) {
  const existing = await client.query('select id from organizations order by created_at asc limit 1');
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await client.query(
    `
      insert into organizations (name, slug)
      values ('AIT CRM', 'ait-crm')
      returning id
    `,
  );
  return inserted.rows[0].id;
}

async function ensureBusinessUnitIds(client, organizationId, roleKey, configuredIds) {
  const cleanIds = configuredIds.filter(Boolean);
  if (cleanIds.length) return cleanIds;

  if (roleKey === 'admin') return [];

  const units = await client.query(
    'select id from business_units where organization_id = $1 and is_active = true order by name asc limit 1',
    [organizationId],
  );

  if (!units.rows.length) {
    throw new Error('At least one business unit is required before creating non-admin users.');
  }

  return [units.rows[0].id];
}

async function main() {
  const connectionString = requiredEnv('DATABASE_URL');
  const email = firstDefinedEnv('AIT_CRM_BOOTSTRAP_EMAIL', 'AIT_CRM_BOOTSTRAP_ADMIN_EMAIL');
  const password = firstDefinedEnv('AIT_CRM_BOOTSTRAP_PASSWORD', 'AIT_CRM_BOOTSTRAP_ADMIN_PASSWORD');
  if (!email) throw new Error('AIT_CRM_BOOTSTRAP_EMAIL (or AIT_CRM_BOOTSTRAP_ADMIN_EMAIL) is required.');
  if (!password) throw new Error('AIT_CRM_BOOTSTRAP_PASSWORD (or AIT_CRM_BOOTSTRAP_ADMIN_PASSWORD) is required.');
  const normalizedEmail = email.trim().toLowerCase();
  const roleKey = firstDefinedEnv('AIT_CRM_BOOTSTRAP_ROLE', 'AIT_CRM_BOOTSTRAP_ADMIN_ROLE') || 'admin';
  const name = firstDefinedEnv('AIT_CRM_BOOTSTRAP_NAME', 'AIT_CRM_BOOTSTRAP_ADMIN_NAME') || 'AIT CRM User';
  const configuredBusinessUnitIds = firstDefinedEnv(
    'AIT_CRM_BOOTSTRAP_BUSINESS_UNIT_IDS',
    'AIT_CRM_BOOTSTRAP_ADMIN_BUSINESS_UNIT_IDS',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!PERMISSIONS[roleKey]) {
    throw new Error(`Unsupported role "${roleKey}". Expected one of: ${Object.keys(PERMISSIONS).join(', ')}.`);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('begin');
    const organizationId = await ensureOrganization(client);

    const permissionIds = new Map();
    for (const key of new Set(Object.values(PERMISSIONS).flat())) {
      const result = await client.query(
        `
          insert into permissions (key, description)
          values ($1, $2)
          on conflict (key) do update set description = excluded.description, updated_at = now()
          returning id
        `,
        [key, `Allows ${key.replace(/[:_]/g, ' ')}.`],
      );
      permissionIds.set(key, result.rows[0].id);
    }

    const roleIds = new Map();
    for (const [key, permissionKeys] of Object.entries(PERMISSIONS)) {
      const role = await client.query(
        `
          insert into roles (organization_id, key, name, description)
          values ($1, $2, $3, $4)
          on conflict (organization_id, key) do update
            set name = excluded.name, description = excluded.description, updated_at = now()
          returning id
        `,
        [organizationId, key, ROLE_NAMES[key], `${ROLE_NAMES[key]} CRM access.`],
      );
      roleIds.set(key, role.rows[0].id);

      await client.query(
        'delete from role_permissions rp using permissions p where rp.permission_id = p.id and rp.role_id = $1 and not (p.key = any($2::text[]))',
        [role.rows[0].id, permissionKeys],
      );

      for (const permissionKey of permissionKeys) {
        await client.query(
          `
            insert into role_permissions (role_id, permission_id)
            values ($1, $2)
            on conflict (role_id, permission_id) do nothing
          `,
          [role.rows[0].id, permissionIds.get(permissionKey)],
        );
      }
    }

    const user = await client.query(
      `
        insert into users (organization_id, name, email, is_active)
        values ($1, $2, $3, true)
        on conflict (email) do update
          set name = excluded.name, organization_id = excluded.organization_id, is_active = true, updated_at = now()
        returning id
      `,
      [organizationId, name, normalizedEmail],
    );
    const userId = user.rows[0].id;

    const { hash, salt } = hashPassword(password);
    await client.query(
      `
        insert into user_password_credentials (user_id, email, password_hash, password_salt, password_iterations)
        values ($1, $2, $3, $4, $5)
        on conflict (email) do update
          set user_id = excluded.user_id,
              password_hash = excluded.password_hash,
              password_salt = excluded.password_salt,
              password_iterations = excluded.password_iterations,
              updated_at = now()
      `,
      [userId, normalizedEmail, hash, salt, PASSWORD_ITERATIONS],
    );

    const roleId = roleIds.get(roleKey);
    if (!roleId) {
      throw new Error(`Role "${roleKey}" is not available in the current organization.`);
    }

    await client.query(
      `
        insert into user_roles (user_id, role_id)
        values ($1, $2)
        on conflict (user_id, role_id) do nothing
      `,
      [userId, roleId],
    );

    const businessUnitIds = await ensureBusinessUnitIds(client, organizationId, roleKey, configuredBusinessUnitIds);
    for (let index = 0; index < businessUnitIds.length; index += 1) {
      const businessUnitId = businessUnitIds[index];
      await client.query(
        `
          insert into business_unit_memberships (business_unit_id, user_id, role_id, is_primary)
          values ($1, $2, $3, $4)
          on conflict (business_unit_id, user_id) do update
            set role_id = excluded.role_id,
                is_primary = excluded.is_primary,
                updated_at = now()
        `,
        [businessUnitId, userId, roleId, index === 0],
      );
    }

    await client.query('commit');
    console.log(`Bootstrapped ${roleKey} user ${normalizedEmail}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
