'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, RefreshCw, UserRoundCheck } from 'lucide-react';
import PageState from '@/components/PageState';
import { canManageAitUsaAssignments } from '@/lib/crm/ait-usa-assignment-policy.js';
import { useCRM } from '@/lib/store';
import s from './RecoveryQueuePage.module.css';

const PAGE_SIZE = 25;

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function ageLabel(item) {
  if (item.lane === 'overdue') return `${item.ageDays} day${item.ageDays === 1 ? '' : 's'} overdue`;
  if (item.lane === 'duplicate_follow_up') return `${item.relatedTaskCount} open tasks`;
  return `${item.ageDays} day${item.ageDays === 1 ? '' : 's'} old`;
}

function itemHref(item) {
  if (item.lane === 'unassigned') return `/contacts/${encodeURIComponent(item.contact.id)}?action=assign-inquiry-owner`;
  if (item.lane === 'overdue' && item.task?.id) return `/tasks/${encodeURIComponent(item.task.id)}`;
  return `/contacts/${encodeURIComponent(item.contact.id)}`;
}

function itemActionLabel(item) {
  if (item.lane === 'unassigned') return 'Assign owner';
  if (item.lane === 'overdue') return 'Open task';
  return 'Open contact';
}

function queueUrl({ lane, page = 1, businessUnitId = '' }) {
  const params = new URLSearchParams({ lane, page: String(page) });
  if (businessUnitId) params.set('businessUnitId', businessUnitId);
  return `/recovery-queue?${params.toString()}`;
}

export default function RecoveryQueuePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    currentBusinessUnitId,
    currentBusinessUnit,
    currentUser,
    loaded,
  } = useCRM();
  const seniorQueue = canManageAitUsaAssignments({ user: currentUser });
  const requestedLane = searchParams.get('lane') || (seniorQueue ? 'overdue' : 'first_contact');
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const urlBusinessUnitId = searchParams.get('businessUnitId') || '';
  const scopedBusinessUnitId = urlBusinessUnitId || (
    currentBusinessUnitId && !['all', 'unassigned'].includes(currentBusinessUnitId)
      ? currentBusinessUnitId
      : ''
  );
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadQueue = useCallback(async () => {
    const params = new URLSearchParams({
      lane: requestedLane,
      page: String(requestedPage),
      pageSize: String(PAGE_SIZE),
    });
    if (scopedBusinessUnitId) params.set('businessUnitId', scopedBusinessUnitId);

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/recovery-queue?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Recovery Queue could not be loaded.');
      setQueue(payload);
      if (payload.lane !== requestedLane || payload.pagination?.page !== requestedPage) {
        router.replace(queueUrl({
          lane: payload.lane,
          page: payload.pagination?.page || 1,
          businessUnitId: scopedBusinessUnitId,
        }));
      }
    } catch (loadError) {
      setError(loadError.message || 'Recovery Queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [requestedLane, requestedPage, router, scopedBusinessUnitId]);

  useEffect(() => {
    if (loaded) queueMicrotask(() => loadQueue());
  }, [loadQueue, loaded]);

  const activeLane = useMemo(
    () => queue?.lanes?.find((lane) => lane.key === queue.lane),
    [queue],
  );
  const personalQueue = Boolean(queue?.scope?.ownerUserId);
  const noAssignedWork = personalQueue && queue?.lanes?.every((lane) => lane.count === 0);

  if (!loaded || (loading && !queue)) {
    return <PageState tone="loading" title="Loading Recovery Queue" copy="Reconciling current Opportunities and commitments…" />;
  }

  if (error && !queue) {
    return (
      <PageState
        tone="error"
        title="Recovery Queue unavailable"
        copy={error}
        actions={<button className="btn btn-primary" type="button" onClick={loadQueue}>Try again</button>}
      />
    );
  }

  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <p className={s.eyebrow}>Daily operations</p>
          <h1>{personalQueue ? 'My Recovery Queue' : 'Recovery Queue'}</h1>
        </div>
        <button className="btn" type="button" onClick={loadQueue} disabled={loading}>
          <RefreshCw size={16} className={loading ? s.spinning : ''} />
          Refresh
        </button>
      </header>

      <div className={s.scopeLine}>
        <strong>{currentBusinessUnit?.name || 'Accessible AIT USA divisions'}</strong>
        {queue?.generatedAt && <span>Updated {formatDateTime(queue.generatedAt)}</span>}
        <span>Views may overlap</span>
      </div>

      {error && (
        <div className={s.inlineError} role="alert">
          <AlertTriangle size={18} />
          <span>{error} Showing the last successful result.</span>
        </div>
      )}

      <div className={s.laneGroups}>
        {[
          { key: 'immediate', label: 'Immediate' },
          { key: 'backlog', label: 'Backlog' },
        ].map((group) => (
          <div key={group.key} className={s.laneGroup}>
            <span className={s.laneGroupLabel}>{group.label}</span>
            <nav className={s.lanes} aria-label={`${group.label} recovery views`}>
              {queue?.lanes?.filter((lane) => lane.group === group.key).map((lane) => (
                <Link
                  key={lane.key}
                  href={queueUrl({ lane: lane.key, businessUnitId: scopedBusinessUnitId })}
                  className={`${s.lane} ${queue.lane === lane.key ? s.laneActive : ''}`}
                  aria-current={queue.lane === lane.key ? 'page' : undefined}
                >
                  <span>{lane.label}</span>
                  <strong>{lane.count}</strong>
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <section className={s.queuePanel} aria-busy={loading}>
        <div className={s.panelHeader}>
          <div>
            <h2>{activeLane?.label || 'Recovery work'}</h2>
            <p>{activeLane?.description}</p>
          </div>
          <span className={s.resultCount}>{queue?.pagination?.total || 0} item{queue?.pagination?.total === 1 ? '' : 's'}</span>
        </div>

        {queue?.items?.length ? (
          <div className={s.items}>
            {queue.items.map((item) => (
              <article key={item.key} className={s.item}>
                <div className={s.itemMain}>
                  <div className={s.itemTitleRow}>
                    <h3>{item.contact.name}</h3>
                    <span className={`${s.urgency} ${s[`urgency_${item.urgency}`] || ''}`}>{ageLabel(item)}</span>
                  </div>
                  {item.lane === 'overdue' && <p className={s.taskTitle}>{item.task?.title || 'Untitled task'}</p>}
                  <div className={s.meta}>
                    {item.opportunity?.status && <span>{item.opportunity.status}</span>}
                    {item.opportunity?.source && <span>{item.opportunity.source}</span>}
                    {item.opportunity?.assignedUserName
                      ? <span><UserRoundCheck size={14} /> {item.opportunity.assignedUserName}</span>
                      : item.lane === 'unassigned' && <span className={s.unassigned}>Unassigned</span>}
                    {item.task?.dueAt && <span><CalendarClock size={14} /> {formatDateTime(item.task.dueAt)}</span>}
                  </div>
                  <div className={s.contactMeta}>
                    {item.contact.phone && <span>{item.contact.phone}</span>}
                    {item.contact.email && <span>{item.contact.email}</span>}
                  </div>
                  {item.lane === 'duplicate_follow_up' && (
                    <div className={s.relatedTasks} aria-label={`Open follow-up tasks for ${item.contact.name}`}>
                      {item.relatedTasks.map((task) => (
                        <Link key={task.id} className={s.relatedTask} href={`/tasks/${encodeURIComponent(task.id)}`} prefetch={false}>
                          <span>{task.title}</span>
                          <span className={s.relatedTaskMeta}>{task.dueAt ? formatDateTime(task.dueAt) : 'No due date'} <ArrowUpRight size={14} /></span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                {(item.lane !== 'duplicate_follow_up' || item.relatedTasks.length === 0) && (
                  <Link className="btn btn-primary" href={itemHref(item)} prefetch={false}>{itemActionLabel(item)}</Link>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className={s.empty}>
            <UserRoundCheck size={28} />
            <h3>{noAssignedWork ? 'No recovery work assigned' : `No ${activeLane?.label?.toLowerCase() || 'recovery work'}`}</h3>
          </div>
        )}

        {queue?.pagination?.totalPages > 1 && (
          <div className={s.pagination}>
            <Link
              className={`btn ${queue.pagination.page <= 1 ? s.disabled : ''}`}
              aria-disabled={queue.pagination.page <= 1}
              href={queueUrl({ lane: queue.lane, page: Math.max(1, queue.pagination.page - 1), businessUnitId: scopedBusinessUnitId })}
            >
              <ChevronLeft size={16} /> Previous
            </Link>
            <span>Page {queue.pagination.page} of {queue.pagination.totalPages}</span>
            <Link
              className={`btn ${queue.pagination.page >= queue.pagination.totalPages ? s.disabled : ''}`}
              aria-disabled={queue.pagination.page >= queue.pagination.totalPages}
              href={queueUrl({ lane: queue.lane, page: Math.min(queue.pagination.totalPages, queue.pagination.page + 1), businessUnitId: scopedBusinessUnitId })}
            >
              Next <ChevronRight size={16} />
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
