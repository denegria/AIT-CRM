'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  ExternalLink,
  History,
  User,
} from 'lucide-react';
import PageState, { PageStateAction } from '@/components/PageState';
import { useRecordScopeRegistration } from '@/components/RecordScopeContext';
import { useCRM } from '@/lib/store';
import { taskDateKey } from '@/lib/tasks/visibility.js';
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

function formatDate(value) {
  const key = taskDateKey(value);
  if (!key) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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

function queueHref(task) {
  const params = new URLSearchParams();
  if (task.taskType) params.set('taskType', task.taskType);
  if (task.status) params.set('status', task.status);
  if (task.ownerUserId) params.set('ownerUserId', task.ownerUserId);
  return `/tasks${params.toString() ? `?${params.toString()}` : ''}`;
}

export default function TaskDetailPage() {
  const params = useParams();
  const {
    access,
    dataSource,
    tasks,
    contacts,
    allContacts,
    employees,
    accessibleBusinessUnits,
    currentUser,
    loaded,
    scopeLabel,
  } = useCRM();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(dataSource === 'postgres');
  const [error, setError] = useState('');
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
  const context = detail?.context || {};
  useRecordScopeRegistration(context.businessUnit, task?.id ? `task:${task.id}` : '');
  const events = detail?.events || [];
  const ownerLabel = context.owner?.name || context.owner?.email || (task?.ownerUserId === currentUser?.id ? 'Me' : 'Unassigned');
  const createdByLabel = context.createdBy?.name || context.createdBy?.email || 'Unknown';
  const renderError = access.canReadCrm ? error : 'CRM read access is required.';
  const headerSubtitle = useMemo(() => {
    if (!task) return '';
    return [
      context.businessUnit?.name || scopeLabel,
      ownerLabel,
      task.dueAt ? `Due ${formatDate(task.dueAt)}` : 'No due date',
    ].filter(Boolean).join(' - ');
  }, [context.businessUnit?.name, ownerLabel, scopeLabel, task]);

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
      <div className={s.topBar}>
        <Link className={s.backLink} href="/tasks"><ArrowLeft size={16} /> Back to tasks</Link>
        <div className={s.actionRow}>
          <Link className="btn btn-sm" href={queueHref(task)}>
            <ClipboardList size={14} />
            Open Queue
          </Link>
          {context.contact?.id && (
            <Link className="btn btn-sm btn-primary" href={`/contacts/${encodeURIComponent(context.contact.id)}`}>
              <ExternalLink size={14} />
              Contact
            </Link>
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

      <div className={s.layout}>
        <main className={s.mainStack}>
          <section className={s.panel}>
            <h2 className={s.panelTitle}><CheckSquare size={17} /> Task</h2>
            {task.description ? (
              <p className={s.description}>{task.description}</p>
            ) : (
              <div className={s.empty}>No description has been added.</div>
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
        </main>

        <aside className={s.sideStack}>
          <section className={s.panel}>
            <h2 className={s.panelTitle}><CalendarClock size={17} /> Metadata</h2>
            <div className={s.metadataGrid}>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>Type</span>
                <span className={s.metadataValue}>{titleCase(task.taskType)}</span>
              </div>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>Due</span>
                <span className={s.metadataValue}>{formatDateTime(task.dueAt)}</span>
              </div>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>Owner</span>
                <span className={s.metadataValue}>{ownerLabel}</span>
              </div>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>Created By</span>
                <span className={s.metadataValue}>{createdByLabel}</span>
              </div>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>{scopeLabel}</span>
                <span className={s.metadataValue}>{context.businessUnit?.name || 'Not set'}</span>
              </div>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>Updated</span>
                <span className={s.metadataValue}>{formatDateTime(task.updatedAt)}</span>
              </div>
            </div>
          </section>

          <section className={s.panel}>
            <h2 className={s.panelTitle}><BriefcaseBusiness size={17} /> Linked Context</h2>
            <div className={s.contextGrid}>
              {context.contact ? (
                <div className={s.contextCard}>
                  <div className={s.contextHeader}>
                    <span className={s.contextTitle}>{context.contact.name || 'Contact'}</span>
                    <Link className={s.contextLink} href={`/contacts/${encodeURIComponent(context.contact.id)}`}>
                      Open <ExternalLink size={12} />
                    </Link>
                  </div>
                  <span className={s.contextText}>
                    {contextText([context.contact.phone || context.contact.email || 'No channel', context.contact.sourceLabel])}
                  </span>
                </div>
              ) : (
                <div className={s.empty}>No contact linked.</div>
              )}

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
            </div>
          </section>

          <section className={s.panel}>
            <h2 className={s.panelTitle}><User size={17} /> Source</h2>
            <div className={s.metadataGrid}>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>Source</span>
                <span className={s.metadataValue}>{task.sourceLabel || task.sourceType || 'Manual'}</span>
              </div>
              <div className={s.metadataItem}>
                <span className={s.metadataLabel}>Created</span>
                <span className={s.metadataValue}>{formatDateTime(task.createdAt)}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
