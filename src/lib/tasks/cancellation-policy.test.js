import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_CANCELLATION_DECISIONS,
  TASK_CANCELLATION_REASON_CODES,
  taskCancellationDecision,
} from './cancellation-policy.js';
import {
  TASK_PRIORITIES,
  TASK_SOURCE_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
} from './constants.js';

function session(roleKeys = ['account_coordinator'], id = 'user-1') {
  return {
    user: {
      id,
      primaryRoleKey: roleKeys[0],
      roleKeys,
    },
  };
}

function task(overrides = {}) {
  return {
    id: 'task-1',
    ownerUserId: 'user-1',
    createdByUserId: 'user-1',
    sourceType: TASK_SOURCE_TYPES.MANUAL,
    taskType: TASK_TYPES.FOLLOW_UP,
    priority: TASK_PRIORITIES.MEDIUM,
    status: TASK_STATUSES.OPEN,
    metadataJson: {},
    ...overrides,
  };
}

const cases = [
  {
    name: 'eligible self-created manual follow-up cancels directly',
    session: session(),
    task: task(),
    decision: TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL,
    reasonCode: TASK_CANCELLATION_REASON_CODES.ELIGIBLE_COORDINATOR_TASK,
  },
  {
    name: 'eligible low-priority manual reminder cancels directly',
    session: session(),
    task: task({ taskType: TASK_TYPES.MANUAL_REMINDER, priority: TASK_PRIORITIES.LOW }),
    decision: TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL,
    reasonCode: TASK_CANCELLATION_REASON_CODES.ELIGIBLE_COORDINATOR_TASK,
  },
  {
    name: 'senior coordinator cancels protected work directly',
    session: session(['senior_coordinator']),
    task: task({ sourceType: TASK_SOURCE_TYPES.AUTOMATION, taskType: TASK_TYPES.FIRST_OUTREACH, priority: TASK_PRIORITIES.URGENT }),
    decision: TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL,
    reasonCode: TASK_CANCELLATION_REASON_CODES.PRIVILEGED_ROLE,
  },
  {
    name: 'legacy sales manager is not granted cancellation authority',
    session: session(['sales_manager']),
    task: task({ ownerUserId: 'user-2', createdByUserId: 'user-2' }),
    decision: TASK_CANCELLATION_DECISIONS.FORBIDDEN,
    reasonCode: TASK_CANCELLATION_REASON_CODES.ROLE_NOT_PERMITTED,
  },
  {
    name: 'admin cancels protected work directly',
    session: session(['admin']),
    task: task({ sourceType: TASK_SOURCE_TYPES.SYSTEM }),
    decision: TASK_CANCELLATION_DECISIONS.DIRECT_CANCEL,
    reasonCode: TASK_CANCELLATION_REASON_CODES.PRIVILEGED_ROLE,
  },
  {
    name: 'non-owned task requires approval',
    session: session(),
    task: task({ ownerUserId: 'user-2' }),
    decision: TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED,
    reasonCode: TASK_CANCELLATION_REASON_CODES.OWNER_MISMATCH,
  },
  {
    name: 'task created by another user requires approval',
    session: session(),
    task: task({ createdByUserId: 'user-2' }),
    decision: TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED,
    reasonCode: TASK_CANCELLATION_REASON_CODES.CREATOR_MISMATCH,
  },
  {
    name: 'automated task requires approval',
    session: session(),
    task: task({ sourceType: TASK_SOURCE_TYPES.AUTOMATION }),
    decision: TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED,
    reasonCode: TASK_CANCELLATION_REASON_CODES.PROTECTED_SOURCE,
  },
  {
    name: 'missing provenance requires approval',
    session: session(),
    task: task({ sourceType: null }),
    decision: TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED,
    reasonCode: TASK_CANCELLATION_REASON_CODES.PROTECTED_SOURCE,
  },
  {
    name: 'first outreach requires approval',
    session: session(),
    task: task({ taskType: TASK_TYPES.FIRST_OUTREACH }),
    decision: TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED,
    reasonCode: TASK_CANCELLATION_REASON_CODES.PROTECTED_TYPE,
  },
  {
    name: 'high-priority task requires approval',
    session: session(),
    task: task({ priority: TASK_PRIORITIES.HIGH }),
    decision: TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED,
    reasonCode: TASK_CANCELLATION_REASON_CODES.PROTECTED_PRIORITY,
  },
  {
    name: 'pending request reuses approval path for regular coordinator',
    session: session(),
    task: task({ metadataJson: { removalApproval: { decision: 'pending' } } }),
    decision: TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED,
    reasonCode: TASK_CANCELLATION_REASON_CODES.PENDING_APPROVAL,
  },
  {
    name: 'completed task is forbidden',
    session: session(),
    task: task({ status: TASK_STATUSES.COMPLETED }),
    decision: TASK_CANCELLATION_DECISIONS.FORBIDDEN,
    reasonCode: TASK_CANCELLATION_REASON_CODES.CLOSED_TASK,
  },
  {
    name: 'approval task is forbidden',
    session: session(['admin']),
    task: task({ taskType: TASK_TYPES.TASK_REMOVAL_APPROVAL }),
    decision: TASK_CANCELLATION_DECISIONS.FORBIDDEN,
    reasonCode: TASK_CANCELLATION_REASON_CODES.APPROVAL_TASK,
  },
  {
    name: 'designer is forbidden',
    session: session(['designer']),
    task: task(),
    decision: TASK_CANCELLATION_DECISIONS.FORBIDDEN,
    reasonCode: TASK_CANCELLATION_REASON_CODES.ROLE_NOT_PERMITTED,
  },
];

for (const scenario of cases) {
  test(scenario.name, () => {
    const result = taskCancellationDecision({ session: scenario.session, task: scenario.task });
    assert.equal(result.decision, scenario.decision);
    assert.equal(result.reasonCode, scenario.reasonCode);
    assert.equal(result.requiresReason, scenario.decision !== TASK_CANCELLATION_DECISIONS.FORBIDDEN);
  });
}
