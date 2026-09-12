import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, taskPlacement } from '../api/contacts/[id]/inquiries/route.js';

const task = Object.freeze({
  id: 'task-1', businessUnitId: 'bu-1', ownerUserId: 'regular-1', taskType: 'placement_review', status: 'completed',
  metadataJson: { placementReview: { state: 'confirmed', finalLevel: 'Level 3', employeeUrl: '/employee/placement-reviews?review=opaque-review-01', rawAnswers: ['forbidden'], rationale: 'forbidden' } },
  createdAt: '2026-09-12T10:00:00.000Z', updatedAt: '2026-09-12T10:01:00.000Z',
});

function session(user) { return { user: { businessUnitIds: ['bu-1'], canAccessAllBusinessUnits: false, roleKeys: [], primaryRoleKey: 'account_coordinator', ...user } }; }

test('inquiry read placement serializer applies task access policy and only emits privacy-safe fields', () => {
  const prior = process.env.AITUSA_EMPLOYEE_BASE_URL;
  process.env.AITUSA_EMPLOYEE_BASE_URL = 'https://employees.aitusa.example';
  try {
    const owner = taskPlacement(task, session({ id: 'regular-1' }));
    const otherRegular = taskPlacement(task, session({ id: 'regular-2' }));
    const senior = taskPlacement(task, session({ id: 'senior-1', primaryRoleKey: 'senior_coordinator', roleKeys: ['senior_coordinator'] }));
    assert.equal(owner.reviewPath, 'https://employees.aitusa.example/employee/placement-reviews?review=opaque-review-01');
    assert.equal(senior.reviewPath, owner.reviewPath);
    assert.equal(otherRegular.reviewPath, '');
    assert.deepEqual(Object.keys(owner).sort(), ['finalLevel', 'finalStatus', 'reviewPath', 'state', 'updatedAt']);
    assert.equal(JSON.stringify(owner).includes('forbidden'), false);
  } finally {
    if (prior === undefined) delete process.env.AITUSA_EMPLOYEE_BASE_URL;
    else process.env.AITUSA_EMPLOYEE_BASE_URL = prior;
  }
});

test('inquiry read serializer fails closed for an invalid employee-link origin and nonmatching task scope', () => {
  const prior = process.env.AITUSA_EMPLOYEE_BASE_URL;
  process.env.AITUSA_EMPLOYEE_BASE_URL = 'https://employees.aitusa.example';
  try {
    const invalidOrigin = taskPlacement({ ...task, metadataJson: { placementReview: { employeeUrl: 'https://attacker.example/employee/placement-reviews?review=opaque-review-01' } } }, session({ id: 'regular-1' }));
    const mismatchedBusinessUnit = taskPlacement({ ...task, businessUnitId: 'bu-other' }, session({ id: 'regular-1' }));
    assert.equal(invalidOrigin.reviewPath, '');
    assert.equal(mismatchedBusinessUnit.reviewPath, '');
  } finally {
    if (prior === undefined) delete process.env.AITUSA_EMPLOYEE_BASE_URL;
    else process.env.AITUSA_EMPLOYEE_BASE_URL = prior;
  }
});

test('inquiry GET deterministically selects the newest exact-org/BU/contact review and serializes complete rows', async () => {
  const queue = [
    [{ id: 'lead-1', organizationId: 'org-1', businessUnitId: 'bu-1', contactId: 'contact-1', assignedUserId: 'senior-1', status: 'Follow Up', programInterest: 'English', sourceName: 'Walk-in', createdAt: '2026-09-01', updatedAt: '2026-09-12T10:00:00.000Z' }],
    [{ id: 'senior-1', name: 'Senior', email: 'senior@example.com' }],
    [
      { ...task, leadId: 'lead-1', contactId: 'contact-1', businessUnitId: 'bu-1', metadataJson: { placementReview: { state: 'confirmed', finalLevel: 'Level 4', employeeUrl: '/employee/placement-reviews?review=newer' } }, createdAt: '2026-09-12T11:00:00.000Z' },
      { ...task, id: 'task-old', leadId: 'lead-1', contactId: 'contact-1', businessUnitId: 'bu-1', metadataJson: { placementReview: { state: 'confirmed', finalLevel: 'Level 1', employeeUrl: '/employee/placement-reviews?review=older' } }, createdAt: '2026-09-12T10:00:00.000Z' },
    ],
    [{ leadId: 'lead-1', occurredAt: '2026-09-12T11:30:00.000Z' }],
  ];
  const db = { select() {
    const rows = queue.shift() || [];
    const query = { from() { return query; }, where() { return query; }, orderBy() { return Promise.resolve(rows); }, then(resolve) { resolve(rows); } };
    return query;
  } };
  const prior = process.env.AITUSA_EMPLOYEE_BASE_URL;
  process.env.AITUSA_EMPLOYEE_BASE_URL = 'https://employees.aitusa.example';
  try {
    const response = await GET(new Request('http://localhost/api/contacts/contact-1/inquiries'), { params: Promise.resolve({ id: 'contact-1' }) }, {
      requirePermissionForRequest: async () => ({ error: null, session: session({ id: 'senior-1', primaryRoleKey: 'senior_coordinator', roleKeys: ['senior_coordinator'], canAccessAllBusinessUnits: true }) }),
      getDbForRequest: () => db,
      resolveContactForRequest: async () => ({ id: 'contact-1', primaryBusinessUnitId: 'bu-1' }),
    });
    assert.equal(response.status, 200);
    const item = (await response.json()).inquiries[0];
    assert.equal(item.owner.label, 'Senior');
    assert.equal(item.lastActivityAt, '2026-09-12T11:30:00.000Z');
    assert.equal(item.placement.finalLevel, 'Level 4');
    assert.match(item.placement.reviewPath, /review=newer$/);
    assert.equal(JSON.stringify(item).includes('rawAnswers'), false);
  } finally {
    if (prior === undefined) delete process.env.AITUSA_EMPLOYEE_BASE_URL;
    else process.env.AITUSA_EMPLOYEE_BASE_URL = prior;
  }
});
