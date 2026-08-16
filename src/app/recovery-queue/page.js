'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, RefreshCw, UserRoundCheck } from 'lucide-react';
import PageState from '@/components/PageState';
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
  return `${item.ageDays} day${item.ageDays === 1 ? '' : 's'} old`;
}

function itemHref(item) {
  if (item.lane === 'duplicate_follow_up') {
    return `/tasks?contactId=${encodeURIComponent(item.contact.id)}&taskType=follow_up&status=open`;
  }
  if (item.task?.id) return `/tasks/${encodeURIComponent(item.task.id)}`;
  return `/contacts/${encodeURIComponent(item.contact.id)}`;
}

function itemActionLabel(item) {
  if (item.lane === 'duplicate_follow_up') return 'Review exact tasks';
  if (item.lane === 'unassigned') return 'Assign owner';
  if (item.task?.id) return 'Open commitment';
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
    loaded,
  } = useCRM();
  const requestedLane = searchParams.get('lane') || 'first_contact';
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
          <h1>Recovery Queue</h1>
          <p className={s.intro}>
            Deterministic work that needs attention now. Every item links back to the existing Contact,
            Opportunity, or exact task—this queue does not create a second workflow.
          </p>
        </div>
        <button className="btn" type="button" onClick={loadQueue} disabled={loading}>
          <RefreshCw size={16} className={loading ? s.spinning : ''} />
          Refresh
        </button>
      </header>

      <div className={s.scopeLine}>
        <span>Scope</span>
        <strong>{currentBusinessUnit?.name || 'Accessible AIT USA divisions'}</strong>
        {queue?.generatedAt && <span>Reconciled {formatDateTime(queue.generatedAt)}</span>}
      </div>

      {error && (
        <div className={s.inlineError} role="alert">
          <AlertTriangle size={18} />
          <span>{error} Showing the last successful result.</span>
        </div>
      )}

      <nav className={s.lanes} aria-label="Recovery Queue lanes">
        {queue?.lanes?.map((lane) => (
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
                  <p className={s.reason}>{item.reason}</p>
                  <div className={s.meta}>
                    {item.opportunity?.status && <span>{item.opportunity.status}</span>}
                    {item.opportunity?.source && <span>{item.opportunity.source}</span>}
                    {item.opportunity?.assignedUserName
                      ? <span><UserRoundCheck size={14} /> {item.opportunity.assignedUserName}</span>
                      : item.lane === 'unassigned' && <span className={s.unassigned}>Unassigned</span>}
                    {item.task?.dueAt && <span><CalendarClock size={14} /> {formatDateTime(item.task.dueAt)}</span>}
                    {item.relatedTaskCount > 1 && <span>{item.relatedTaskCount} open follow-ups</span>}
                  </div>
                  <div className={s.contactMeta}>
                    {item.contact.phone && <span>{item.contact.phone}</span>}
                    {item.contact.email && <span>{item.contact.email}</span>}
                  </div>
                </div>
                <Link className="btn btn-primary" href={itemHref(item)} prefetch={false}>{itemActionLabel(item)}</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className={s.empty}>
            <UserRoundCheck size={28} />
            <h3>No work in this lane</h3>
            <p>The current filtered list reconciles to zero.</p>
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
