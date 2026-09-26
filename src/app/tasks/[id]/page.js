'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  ExternalLink,
  History,
  MoreHorizontal,
  ShieldAlert,
  X,
} from 'lucide-react';
import PageState, { PageStateAction } from '@/components/PageState';
import { useRecordScopeRegistration } from '@/components/RecordScopeContext';
import { TaskCancellationDialog } from '@/components/TaskCancellationDialog';
import { TaskRemovalDecisionDialog } from '@/components/TaskRemovalDecisionDialog';
import { useToast } from '@/components/Toast';
import { useCRM } from '@/lib/store';
import { isAssignableEmployee } from '@/lib/crm/assignable-employees.js';
import { coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import {
  TASK_CANCELLATION_DECISIONS,
  taskCancellationDecision,
} from '@/lib/tasks/cancellation-policy.js';
import { followUpTaskEntryHref } from '@/lib/tasks/follow-up-selection.js';
import { taskQueueReturnHref } from '@/lib/tasks/queue-navigation.js';
import { taskOverdueAgeLabel } from '@/lib/tasks/visibility.js';
import {
  canReviewTaskRemovalApprovals,
  taskRemovalApprovalState,
} from '@/lib/tasks/removal-approval-view.js';
import s from './TaskDetail.module.css';

function titleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function badgeClass(status) {
  if (status === 'completed') return 'badge-completed';
  if (status === 'canceled') return 'badge-lost';
  if (status === 'snoozed') return 'badge-pending';
  return 'badge-contacted';
}

function contextText(parts) {
  return parts.filter(Boolean).join(' - ');
}

function fallbackTaskDetail(task, contacts, employees, accessibleBusinessUnits) {
  const contact = contacts.find((row) => row.id === task.contactId) || null;
  const owner = employees.find((row) => row.id === (task.ownerUserId || task.assignedTo)) || null;
  const businessUnit = accessibleBusinessUnits.find((row) => row.id === task.businessUnitId) || null;
  return {
    task: {
      ...task,
      description: task.description || '',
      taskType: task.taskType || 'manual_reminder',
      status: task.status || task.taskStatus || (task.completed ? 'completed' : 'open'),
      priority: String(task.priority || 'medium').toLowerCase(),
      dueAt: task.dueAt || task.dueDate || null,
      ownerUserId: task.ownerUserId || task.assignedTo || '',
      metadataJson: task.metadataJson || {},
    },
    context: {
      businessUnit,
      owner,
      createdBy: null,
      contact,
      lead: null,
      workOrder: null,
    },
    events: [],
  };
}

export default function TaskDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const {
    access,
    dataSource,
    tasks,
    contacts,
    allContacts,
    employees,
    accessibleBusinessUnits,
    currentUser,
    setCurrentBusinessUnitId,
    loaded,
    scopeLabel,
  } = useCRM();
  const { toast } = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(dataSource === 'postgres');
  const [error, setError] = useState('');
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationBusy, setCancellationBusy] = useState(false);
  const [cancellationError, setCancellationError] = useState('');
  const [removalDecision, setRemovalDecision] = useState(null);
  const [removalDecisionReason, setRemovalDecisionReason] = useState('');
  const [removalDecisionBusy, setRemovalDecisionBusy] = useState(false);
  const [removalDecisionError, setRemovalDecisionError] = useState('');
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const taskId = params.id;
  const visibleContacts = allContacts?.length ? allContacts : contacts;

  useEffect(() => {
    let cancelled = false;
    if (!access.canReadCrm) {
      return undefined;
    }
    if (dataSource !== 'postgres') {
      queueMicrotask(() => {
        if (cancelled) return;
        const task = (tasks || []).find((row) => row.id === taskId);
        if (task) {
          setDetail(fallbackTaskDetail(task, visibleContacts, employees, accessibleBusinessUnits));
          setError('');
        } else if (loaded) {
          setError('Task not found.');
        }
        setLoading(false);
      });
      return undefined;
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError('');
      fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store' })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || 'Task not found.');
          if (!cancelled) setDetail(payload);
        })
        .catch((err) => {
          if (!cancelled) {
            setDetail(null);
            setError(err.message || 'Task not found.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [access.canReadCrm, accessibleBusinessUnits, dataSource, employees, loaded, taskId, tasks, visibleContacts]);

  const task = detail?.task || null;
  const overdueAgeLabel = task ? taskOverdueAgeLabel(task) : '';
  const returnTo = taskQueueReturnHref(searchParams.get('returnTo') || '', task?.businessUnitId || '');
  const alignTaskDivision = () => {
    if (task?.businessUnitId) setCurrentBusinessUnitId(task.businessUnitId);
  };
  const context = detail?.context || {};
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const assignableEmployees = useMemo(() => {
    const options = (employees || []).filter(isAssignableEmployee);
    if (!currentUser?.id || options.some((employee) => employee.id === currentUser.id) || !isAssignableEmployee(currentUser)) {
      return options;
    }
    return [currentUser, ...options];
  }, [currentUser, employees]);
  useRecordScopeRegistration(context.businessUnit, task?.id ? `task:${task.id}` : '');
  const events = detail?.events || [];
  const ownerLabel = context.owner?.name || context.owner?.email || (task?.ownerUserId === currentUser?.id ? 'Me' : 'Unassigned');
  const createdByLabel = context.createdBy?.name || context.createdBy?.email || 'Unknown';
  const cancellationPolicy = task?.cancellationPolicy || (task
    ? taskCancellationDecision({ session: { user: currentUser }, task })
    : null);
  const cancellationNeedsApproval = cancellationPolicy?.decision === TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED;
  const removalApproval = taskRemovalApprovalState(task);
  const cancellationPending = removalApproval?.decision === 'pending';
  const isTaskRemovalApproval = task?.taskType === 'task_removal_approval';
  const removalApprovalMetadata = isTaskRemovalApproval ? task?.metadataJson || {} : null;
  const canReviewRemovalApproval = Boolean(
    access.canWriteCrm &&
    isTaskRemovalApproval &&
    ['open', 'in_progress', 'snoozed'].includes(task?.status) &&
    canReviewTaskRemovalApprovals(currentUser)
  );
  const canCancelTask = Boolean(
    access.canWriteCrm &&
    task &&
    !cancellationPending &&
    cancellationPolicy?.decision !== TASK_CANCELLATION_DECISIONS.FORBIDDEN
  );
  const canLogOutcome = Boolean(
    access.canWriteCrm &&
    task?.taskType === 'follow_up' &&
    ['open', 'in_progress', 'snoozed'].includes(task?.status)
  );
  const renderError = access.canReadCrm ? error : 'CRM read access is required.';
  const headerSubtitle = useMemo(() => {
    if (!task) return '';
    return context.businessUnit?.name || scopeLabel;
  }, [context.businessUnit?.name, scopeLabel, task]);

  async function submitCancellation() {
    const reason = String(cancellationReason || '').trim();
    if (!task?.id || !reason || cancellationBusy) return;
    setCancellationBusy(true);
    setCancellationError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: task.id, action: 'cancel', reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Task cancellation failed.');
      setDetail((current) => current ? { ...current, task: payload.task || current.task } : current);
      setCancellationOpen(false);
      setCancellationReason('');
      toast(payload.approvalRequested ? 'Task cancellation requested' : 'Task canceled');
    } catch (err) {
      setCancellationError(err.message || 'Task cancellation failed.');
    } finally {
      setCancellationBusy(false);
    }
  }

  async function assignTask(ownerUserId) {
    if (!task?.id || !ownerUserId || assignmentBusy || !coordinatorUiPolicy.canManageCoordinatorAssignments) return;
    setAssignmentBusy(true);
    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: task.id,
          action: 'assign',
          ownerUserId,
          expectedUpdatedAt: task.updatedAt,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Task assignment failed.');
      const nextTask = payload.task || { ...task, ownerUserId };
      const nextOwner = assignableEmployees.find((employee) => employee.id === nextTask.ownerUserId) || null;
      setDetail((current) => current ? {
        ...current,
        task: nextTask,
        context: { ...current.context, owner: nextOwner },
      } : current);
      toast('Task owner updated');
    } catch (err) {
      toast(err.message || 'Task assignment failed.');
    } finally {
      setAssignmentBusy(false);
    }
  }

  function openRemovalDecision(decision) {
    if (!canReviewRemovalApproval) return;
    setRemovalDecision(decision);
    setRemovalDecisionReason(decision === 'approve'
      ? removalApprovalMetadata?.requestedReason || 'Task cancellation approved.'
      : '');
    setRemovalDecisionError('');
  }

  async function submitRemovalDecision() {
    if (!task?.id || !removalDecision || removalDecisionBusy) return;
    setRemovalDecisionBusy(true);
    setRemovalDecisionError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: task.id,
          action: removalDecision === 'approve' ? 'approve_task_removal' : 'deny_task_removal',
          reason: removalDecisionReason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Cancellation decision failed.');
      setDetail((current) => current ? { ...current, task: payload.task || current.task } : current);
      setRemovalDecision(null);
      setRemovalDecisionReason('');
      toast(payload.decision === 'superseded'
        ? 'Cancellation request closed because the task already changed'
        : payload.decision === 'approve'
          ? 'Task cancellation approved'
          : 'Task cancellation denied');
    } catch (err) {
      setRemovalDecisionError(err.message || 'Cancellation decision failed.');
    } finally {
      setRemovalDecisionBusy(false);
    }
  }

  if (loading && access.canReadCrm) {
    return <PageState tone="loading" title="Loading task" copy="Preparing task details, linked records, and activity history." />;
  }

  if (renderError || !task) {
    return (
      <div className={s.detailShell}>
        <Link className={s.backLink} href="/tasks"><ArrowLeft size={16} /> Back to tasks</Link>
        <PageState
          tone={renderError ? 'error' : 'not-found'}
          title={renderError ? 'Task cannot be opened' : 'Task not found'}
          copy={renderError || 'This task may be outside your current scope or no longer available.'}
          actions={<PageStateAction href="/tasks">Open Task Queue</PageStateAction>}
        />
      </div>
    );
  }

  return (
    <div className={s.detailShell}>
      <div className={`${s.topBar} app-notification-safe`}>
        <Link className={s.backLink} href={returnTo} onClick={alignTaskDivision}><ArrowLeft size={16} /> Back to tasks</Link>
        <div className={s.actionRow}>
          {canReviewRemovalApproval && (
            <>
              <button className="btn btn-sm" type="button" onClick={() => openRemovalDecision('deny')}>
                <X size={14} /> Deny
              </button>
              <button className="btn btn-sm btn-primary" type="button" onClick={() => openRemovalDecision('approve')}>
                <CheckCircle2 size={14} /> Approve
              </button>
            </>
          )}
          {canCancelTask && (
            <details className={s.moreMenu}>
              <summary className="btn btn-sm">
                <MoreHorizontal size={14} />
                More
              </summary>
              <div className={s.moreMenuPanel}>
                <button
                  className={`btn btn-sm ${cancellationNeedsApproval ? '' : 'btn-danger'}`}
                  type="button"
                  onClick={() => {
                    setCancellationError('');
                    setCancellationReason('');
                    setCancellationOpen(true);
                  }}
                >
                  <X size={14} />
                  {cancellationNeedsApproval ? 'Request Cancel' : 'Cancel task'}
                </button>
              </div>
            </details>
          )}
        </div>
      </div>

      <div className={s.titleBlock}>
        <div className={s.titleLine}>
          <h1 className={s.taskTitle}>{task.title || 'Untitled task'}</h1>
          <span className={`badge ${badgeClass(task.status)}`}>{titleCase(task.status)}</span>
          <span className={`badge badge-${task.priority || 'medium'}`}>{titleCase(task.priority || 'medium')}</span>
        </div>
        <p className={s.subtitle}>{headerSubtitle}</p>
      </div>

      <main className={s.mainStack}>
          {!isTaskRemovalApproval && removalApproval && (
            <section className={`${s.statusPanel} ${cancellationPending ? s.statusPanelPending : ''}`}>
              <div className={s.statusIcon}><ShieldAlert size={20} /></div>
              <div className={s.statusBody}>
                <span className={s.statusEyebrow}>Cancellation request</span>
                <h2>
                  {cancellationPending
                    ? 'Cancellation pending review'
                    : removalApproval.decision === 'denied'
                      ? 'Cancellation denied'
                      : removalApproval.decision === 'superseded'
                        ? 'Cancellation request closed'
                        : 'Cancellation approved'}
                </h2>
                <p>{removalApproval.decisionReason || removalApproval.requestedReason || 'Awaiting an eligible reviewer.'}</p>
                {cancellationPending && (
                  <span className={s.statusHint}>You can keep working this task. Completing it automatically closes the request.</span>
                )}
              </div>
            </section>
          )}

          {isTaskRemovalApproval && (
            <section className={s.approvalPanel}>
              <div className={s.approvalHeader}>
                <div>
                  <span className={s.statusEyebrow}>Protected task cancellation</span>
                  <h2>{removalApprovalMetadata?.targetTaskTitle || 'Cancellation approval'}</h2>
                </div>
                <span className={`badge ${task.status === 'open' ? 'badge-pending' : badgeClass(task.status)}`}>
                  {titleCase(removalApprovalMetadata?.decision || task.status)}
                </span>
              </div>
              <dl className={s.approvalGrid}>
                <div><dt>Requested by</dt><dd>{removalApprovalMetadata?.requesterName || removalApprovalMetadata?.requesterEmail || 'Coordinator'}</dd></div>
                <div><dt>Requested</dt><dd>{formatDateTime(removalApprovalMetadata?.requestedAt)}</dd></div>
                <div><dt>Review lane</dt><dd>{task.ownerUserId ? ownerLabel : 'Shared approval queue'}</dd></div>
                <div className={s.approvalReason}><dt>Requested reason</dt><dd>{removalApprovalMetadata?.requestedReason || 'No reason recorded.'}</dd></div>
                {removalApprovalMetadata?.decisionReason && (
                  <div className={s.approvalReason}><dt>Decision note</dt><dd>{removalApprovalMetadata.decisionReason}</dd></div>
                )}
              </dl>
              {removalApprovalMetadata?.targetTaskId && (
                <Link className="btn btn-sm" href={`/tasks/${encodeURIComponent(removalApprovalMetadata.targetTaskId)}`}>
                  <ExternalLink size={14} /> Open target task
                </Link>
              )}
            </section>
          )}

          <section className={s.panel} aria-labelledby="task-briefing-title">
            <h2 className={s.panelTitle} id="task-briefing-title"><CheckSquare size={17} /> What needs doing</h2>
            {task.description ? (
              <p className={s.description}>{task.description}</p>
            ) : (
              <div className={s.empty}>No description has been added.</div>
            )}
            <div className={s.contactRow}>
              <span className={s.metadataLabel}>Who this concerns</span>
              <div className={s.contactIdentity}>
                {context.contact?.id ? (
                  <>
                    <Link className={s.workFactLink} href={`/contacts/${encodeURIComponent(context.contact.id)}`}>
                      {context.contact.name || 'Linked contact'} <ExternalLink size={13} />
                    </Link>
                    <span className={s.workFactHint}>{context.contact.phone || context.contact.email || 'No contact channel'}</span>
                  </>
                ) : (
                  <span className={s.metadataValue}>No contact linked</span>
                )}
              </div>
            </div>
            {(context.lead || context.workOrder || task.placementReviewLink) && (
              <div className={s.contextGrid} aria-label="Related work">
                {context.lead && (
                  <div className={s.contextCard}>
                    <span className={s.contextTitle}>Lead</span>
                    <span className={s.contextText}>
                      {contextText([context.lead.currentStage || context.lead.status, context.lead.sourceName || context.lead.sourceType])}
                    </span>
                  </div>
                )}
                {context.workOrder && (
                  <div className={s.contextCard}>
                    <div className={s.contextHeader}>
                      <span className={s.contextTitle}>{context.workOrder.title || context.workOrder.workOrderNumber || 'Work order'}</span>
                      {context.workOrder.canOpen && (
                        <Link className={s.contextLink} href={`/work-orders/${encodeURIComponent(context.workOrder.id)}`}>
                          Open <ExternalLink size={12} />
                        </Link>
                      )}
                    </div>
                    <span className={s.contextText}>{titleCase(context.workOrder.status)}</span>
                  </div>
                )}
                {task.placementReviewLink && (
                  <div className={s.contextCard}>
                    <div className={s.contextHeader}>
                      <span className={s.contextTitle}>AIT USA placement review</span>
                      <a className={s.contextLink} href={task.placementReviewLink} target="_blank" rel="noreferrer">
                        Open AIT USA review <ExternalLink size={12} />
                      </a>
                    </div>
                    <span className={s.contextText}>Opens the authorized AIT USA employee queue.</span>
                  </div>
                )}
              </div>
            )}
            <div className={s.workFacts}>
              <div className={s.workFact}>
                <span className={s.metadataLabel}>Due</span>
                <span className={s.dueValue}>
                  <span className={s.metadataValue}>{formatDateTime(task.dueAt)}</span>
                  {overdueAgeLabel && <span className={s.overdueCue}>{overdueAgeLabel}</span>}
                </span>
              </div>
              <div className={s.workFact}>
                <span className={s.metadataLabel}>Owner</span>
                {coordinatorUiPolicy.canManageCoordinatorAssignments && !isTaskRemovalApproval ? (
                  <select
                    className={`select ${s.ownerSelect}`}
                    aria-label="Task owner"
                    value={task.ownerUserId || ''}
                    disabled={assignmentBusy || !access.canWriteCrm}
                    onChange={(event) => assignTask(event.target.value)}
                  >
                    <option value="" disabled>Unassigned</option>
                    {assignableEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name || employee.email}</option>
                    ))}
                  </select>
                ) : (
                  <span className={s.metadataValue}>{ownerLabel}</span>
                )}
              </div>
            </div>
            {canLogOutcome && (
              <div className={s.actionBand}>
                <Link className="btn btn-primary" href={followUpTaskEntryHref(task, { returnTo })} onClick={alignTaskDivision}>
                  <CheckCircle2 size={16} /> Log outcome
                </Link>
              </div>
            )}
          </section>

          <section className={s.panel}>
            <h2 className={s.panelTitle}><History size={17} /> History</h2>
            {events.length ? (
              <div className={s.timeline}>
                {events.map((event) => (
                  <div key={event.id} className={s.eventItem}>
                    <span className={s.eventDot}><History size={14} /></span>
                    <div className={s.eventBody}>
                      <div className={s.eventTitle}>{event.message || titleCase(event.eventType)}</div>
                      <div className={s.eventMeta}>
                        {formatDateTime(event.occurredAt)}
                        {event.actor?.name || event.actor?.email ? ` by ${event.actor.name || event.actor.email}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={s.empty}>No task events yet.</div>
            )}
          </section>
          <details className={s.recordDetails}>
            <summary>Record details</summary>
            <dl className={s.detailsList}>
              <div><dt>Type</dt><dd>{titleCase(task.taskType)}</dd></div>
              <div><dt>Source</dt><dd>{task.sourceLabel || task.sourceType || 'Manual'}</dd></div>
              <div><dt>Created by</dt><dd>{createdByLabel}</dd></div>
              <div><dt>Created</dt><dd>{formatDateTime(task.createdAt)}</dd></div>
              <div><dt>Updated</dt><dd>{formatDateTime(task.updatedAt)}</dd></div>
            </dl>
          </details>
      </main>

      <TaskCancellationDialog
        open={cancellationOpen && canCancelTask}
        task={task}
        policy={cancellationPolicy}
        reason={cancellationReason}
        busy={cancellationBusy}
        error={cancellationError}
        onClose={() => setCancellationOpen(false)}
        onReasonChange={setCancellationReason}
        onSubmit={submitCancellation}
      />
      <TaskRemovalDecisionDialog
        open={Boolean(removalDecision && canReviewRemovalApproval)}
        task={task}
        decision={removalDecision || 'approve'}
        reason={removalDecisionReason}
        busy={removalDecisionBusy}
        error={removalDecisionError}
        onClose={() => !removalDecisionBusy && setRemovalDecision(null)}
        onReasonChange={setRemovalDecisionReason}
        onSubmit={submitRemovalDecision}
      />
    </div>
  );
}
