'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Database, Eye, Filter, HelpCircle, Lock, RefreshCw, Search, X } from 'lucide-react';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'needs_review', label: 'Needs review' },
];

const TYPE_LABELS = {
  all: 'All record types',
  lead: 'Lead',
  estimate: 'Estimate',
  work_order: 'Work order',
  payment_snapshot: 'Payment',
  activity_event: 'Activity event',
  note: 'Note',
};

const QUALITY_OPTIONS = [
  { value: 'all', label: 'All quality' },
  { value: 'ready_for_follow_up', label: 'Ready for follow-up' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'suppress_from_follow_up', label: 'Suppress from follow-up' },
  { value: 'phone_only', label: 'Phone only' },
  { value: 'dead_contact', label: 'Wrong / dead contact' },
  { value: 'old_or_stale', label: 'Old / stale' },
  { value: 'source_unclear', label: 'Source unclear' },
];
const QUALITY_DISPOSITION_FILTERS = new Set(['ready_for_follow_up', 'needs_review', 'suppress_from_follow_up']);
const OUTCOME_BUCKETS = [
  {
    value: 'ready_for_follow_up',
    label: 'Ready for follow-up',
    className: 'outcome-ready',
    description: 'Leads with enough usable contact/context to enter normal follow-up.',
  },
  {
    value: 'needs_review',
    label: 'Needs review',
    className: 'outcome-review',
    description: 'Leads blocked from automatic promotion until an operator resolves missing identity or ambiguous source evidence.',
  },
  {
    value: 'suppress_from_follow_up',
    label: 'Suppress from follow-up',
    className: 'outcome-suppress',
    description: 'Dead, bad, duplicate, or explicitly uninterested leads that should not enter the active follow-up queue.',
  },
];
const SECONDARY_BUCKETS = [
  {
    value: 'phone_only',
    label: 'Phone only',
    description: 'Rows with a usable phone but no reliable prospect name. This overlaps with other buckets.',
  },
  {
    value: 'dead_contact',
    label: 'Wrong / dead contact',
    description: 'Wrong numbers, disconnected numbers, do-not-contact, not-current, and repeated no-answer signals.',
  },
  {
    value: 'old_or_stale',
    label: 'Old / stale',
    description: 'Older leads. Informational flag; it can overlap with ready, review, or suppress.',
  },
  {
    value: 'source_unclear',
    label: 'Source unclear',
    description: 'Rows whose acquisition/source hint is unclear. Informational unless paired with another blocker.',
  },
];

function labelForType(value) {
  return TYPE_LABELS[value] || value.replace(/_/g, ' ');
}

function proposalForRow(row) {
  if (row?.record_type === 'lead') return row.proposed_lead_json || {};
  if (row?.record_type === 'estimate') return row.proposed_estimate_json || {};
  if (row?.record_type === 'work_order') return row.proposed_work_order_json || {};
  if (row?.record_type === 'payment_snapshot') return row.proposed_payment_json || {};
  if (row?.record_type === 'note') return row.proposed_note_json || {};
  return (
    row?.proposed_lead_json ||
    row?.proposed_estimate_json ||
    row?.proposed_work_order_json ||
    row?.proposed_payment_json ||
    row?.proposed_note_json ||
    row?.proposed_contact_json ||
    {}
  );
}

function businessUnitForRow(row, batch) {
  const proposal = proposalForRow(row);
  return row?.business_unit_name || proposal.businessUnit || batch?.businessUnitName || 'Unassigned';
}

function qualityForRow(row) {
  const proposal = proposalForRow(row);
  const metadata = proposal.leadMetadata || {};
  const contact = row?.proposed_contact_json || {};
  return {
    disposition: metadata.qualityDisposition || contact.qualityDisposition || null,
    flags: metadata.qualityFlags || contact.qualityFlags || [],
    sourceTags: metadata.sourceTags || contact.sourceTags || [],
    contactability: metadata.contactability || contact.contactability || null,
  };
}

function qualityBadgeClass(value) {
  if (value === 'ready_for_follow_up') return 'badge-won';
  if (value === 'suppress_from_follow_up') return 'badge-lost';
  if (value === 'needs_review') return 'badge-medium';
  return 'badge-pending';
}

function qualityLabel(value) {
  if (value === 'ready_for_follow_up') return 'Ready';
  if (value === 'suppress_from_follow_up') return 'Suppress';
  if (value === 'needs_review') return 'Review';
  return 'Unscored';
}

function countByKey(rows = [], keyName, value) {
  const row = rows.find((item) => item[keyName] === value);
  return Number(row?.count || 0);
}

function countFlags(rows = [], values = []) {
  return rows
    .filter((item) => values.includes(item.flag))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
}

function qualityCount(summary, value) {
  if (!summary) return 0;
  if (QUALITY_DISPOSITION_FILTERS.has(value)) {
    return countByKey(summary.qualityDispositionCounts || [], 'disposition', value);
  }
  if (value === 'phone_only') return countFlags(summary.qualityFlagCounts || [], ['phone_only']);
  if (value === 'dead_contact') return countFlags(summary.qualityFlagCounts || [], ['wrong_number', 'disconnected', 'do_not_contact', 'not_current', 'repeated_no_answer']);
  if (value === 'old_or_stale') return countFlags(summary.qualityFlagCounts || [], ['stale_or_old_lead']);
  if (value === 'source_unclear') return countFlags(summary.qualityFlagCounts || [], ['source_unclear']);
  return Number(summary.counts?.normalizedRecords || 0);
}

function formatPercent(count, total) {
  const numericCount = Number(count || 0);
  const numericTotal = Number(total || 0);
  if (!numericTotal) return '0%';
  const percent = (numericCount / numericTotal) * 100;
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`;
}

function leadOutcomeTotal(summary) {
  return OUTCOME_BUCKETS.reduce((sum, bucket) => sum + qualityCount(summary, bucket.value), 0);
}

function sortedCountRows(rows = [], key = 'reason') {
  return [...rows]
    .map((row) => ({ label: row[key] || 'Unknown', count: Number(row.count || 0) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function sheetMixForDisposition(summary, disposition) {
  return sortedCountRows(
    (summary?.qualityDispositionSheetCounts || []).filter((row) => row.disposition === disposition),
    'source_sheet',
  );
}

function batchLabel(batch) {
  if (!batch) return 'Latest matching batch';
  const source = batch.fileName || batch.sourceName || batch.id;
  const unit = batch.businessUnitName || 'Unassigned';
  const count = Number.isFinite(Number(batch.reviewableCount)) ? ` · ${Number(batch.reviewableCount).toLocaleString()} reviewable` : '';
  return `${unit} · ${source}${count}`;
}

function sheetContextForRow(row) {
  const sourceSheet = String(row?.source_sheet || '').toLowerCase();
  const proposal = proposalForRow(row);
  const sourceType = proposal.sourceType;

  if (sourceSheet.includes('interes') || sourceType === 'lead') {
    return {
      label: 'Prospects',
      detail: 'Interested leads only. Not estimates or work orders yet.',
    };
  }
  if (sourceType === 'ait_usa_xlsx') {
    return {
      label: 'AIT USA follow-up',
      detail: 'Lead and follow-up history from the AIT USA seguimiento workbook.',
    };
  }
  if (sourceSheet.includes('estim') || sourceType === 'estimate') {
    return {
      label: 'Estimates',
      detail: 'Proposal sheet. Totals and balances are estimate fields unless explicit payment columns are filled.',
    };
  }
  if (sourceSheet.includes('termin') || sourceSheet.includes('pagad') || sourceType === 'archive') {
    return {
      label: 'Completed / paid work',
      detail: 'Finished work-order archive. Strongest evidence that a job was completed and paid.',
    };
  }
  if (sourceSheet.includes('work order') || sourceType === 'work_order') {
    return {
      label: 'Active work orders',
      detail: 'Active production work. Payments here are deposits or collections tied to active jobs.',
    };
  }
  return {
    label: 'Unmapped sheet',
    detail: 'Needs operator confirmation before promotion.',
  };
}

function interpretationForRow(row) {
  const context = sheetContextForRow(row);
  const proposal = proposalForRow(row);
  const recordLabel = labelForType(row?.record_type || 'note');
  if (row?.record_type === 'payment_snapshot') {
    if (proposal.paymentSource !== 'explicit_payment_columns') {
      return `${context.label}: legacy payment label. Verify the source sheet and payment columns before approving.`;
    }
    return `${context.label}: explicit payment columns detected. Review this as payment evidence tied to the source row, not as the primary job record.`;
  }
  if (proposal.paymentHint) {
    return `${context.label}: ${recordLabel.toLowerCase()} with explicit payment evidence in the payment columns.`;
  }
  return `${context.label}: review as ${recordLabel.toLowerCase()}. ${context.detail}`;
}

function badgeClassForStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'approved') return 'badge-won';
  if (value === 'rejected') return 'badge-lost';
  if (value === 'needs_review') return 'badge-medium';
  return 'badge-pending';
}

function formatConfidence(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value);
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return `${Math.round(percent)}%`;
}

function summarizeJson(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .slice(0, 6)
    .map(([key, v]) => [key, Array.isArray(v) ? `${v.length} items` : typeof v === 'object' ? JSON.stringify(v) : String(v)]);
}

function formatDate(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ImportReviewPage() {
  const { loaded, dataSource, access, businessUnits } = useCRM();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ status: 'pending', type: 'all', quality: 'all', q: '', limit: 120, offset: 0, businessUnitId: 'all', batchId: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [batch, setBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ totalCount: 0, limit: 120, offset: 0, returnedCount: 0, hasPreviousPage: false, hasNextPage: false });
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    if (!loaded || dataSource !== 'postgres') return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('status', filters.status);
        params.set('type', filters.type);
        params.set('quality', filters.quality);
        if (filters.businessUnitId !== 'all') params.set('businessUnitId', filters.businessUnitId);
        if (filters.batchId) params.set('batchId', filters.batchId);
        if (filters.q.trim()) params.set('q', filters.q.trim());
        params.set('limit', String(filters.limit));
        params.set('offset', String(filters.offset));

        const response = await fetch(`/api/import-review?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();

        if (!response.ok) {
          if (response.status === 401) setAuthRequired(true);
          throw new Error(payload.error || 'Unable to load import review queue.');
        }

        setAuthRequired(false);
        setBatch(payload.batch);
        setBatches(payload.batches || []);
        setSummary(payload.summary);
        setRows(payload.rows || []);
        setPagination(payload.pagination || { totalCount: payload.rows?.length || 0, limit: filters.limit, offset: filters.offset, returnedCount: payload.rows?.length || 0, hasPreviousPage: false, hasNextPage: false });
        setSelectedIds((prev) => prev.filter((id) => (payload.rows || []).some((row) => row.id === id)));
        setActiveId((prev) => {
          if (prev && (payload.rows || []).some((row) => row.id === prev)) return prev;
          return payload.rows?.[0]?.id || null;
        });
        setError('');
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Unable to load import review queue.');
          setRows([]);
          setPagination({ totalCount: 0, limit: filters.limit, offset: filters.offset, returnedCount: 0, hasPreviousPage: false, hasNextPage: false });
          setSummary(null);
          setBatch(null);
          setBatches([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [dataSource, filters, loaded, reloadKey]);

  const activeRow = useMemo(
    () => rows.find((row) => row.id === activeId) || rows[0] || null,
    [activeId, rows],
  );

  const rowIds = rows.map((row) => row.id);
  const allVisibleSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.includes(id));
  const selectedCount = selectedIds.filter((id) => rowIds.includes(id)).length;
  const canReview = access.canWriteImportReview;
  const batchHasBusinessUnit = Boolean(batch?.businessUnitId || batch?.businessUnitName);
  const canApproveRows = canReview && batchHasBusinessUnit;
  const pageStart = pagination.totalCount > 0 ? pagination.offset + 1 : 0;
  const pageEnd = Math.min(pagination.offset + rows.length, pagination.totalCount);
  const totalRowsLabel = pagination.totalCount.toLocaleString();
  const pageRowsLabel = `${pageStart.toLocaleString()}-${pageEnd.toLocaleString()} of ${totalRowsLabel}`;
  const leadOutcomeCount = leadOutcomeTotal(summary);
  const needsReviewReasons = sortedCountRows(summary?.needsReviewReasonCounts || []);
  const suppressReasons = sortedCountRows(summary?.suppressReasonCounts || []);
  const needsReviewSheetMix = sheetMixForDisposition(summary, 'needs_review');
  const goToPreviousPage = () => {
    setFilters((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }));
  };
  const goToNextPage = () => {
    setFilters((prev) => ({ ...prev, offset: prev.offset + prev.limit }));
  };

  async function unlockAdminSession(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/admin-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: adminToken }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to unlock admin session.');
      }

      setAdminToken('');
      setAuthRequired(false);
      setError('');
      setReloadKey((key) => key + 1);
      toast('Import review unlocked for this browser session.', 'success');
    } catch (err) {
      toast(err.message || 'Unable to unlock admin session.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function updateRows(recordIds, status) {
    if (!recordIds.length) return;
    setSaving(true);
    try {
      const response = await fetch('/api/import-review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: batch?.id || null,
          recordIds,
          status,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to update staged records.');
      }

      toast(`${recordIds.length} row${recordIds.length === 1 ? '' : 's'} marked ${status.replace('_', ' ')}`, 'success');
      setSelectedIds((prev) => prev.filter((id) => !recordIds.includes(id)));
      setActiveId((prev) => (recordIds.includes(prev) ? null : prev));
      setReloadKey((key) => key + 1);
    } catch (err) {
      toast(err.message || 'Unable to update staged records.', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="empty-state">Loading...</div>;

  if (dataSource !== 'postgres') {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Import Review</h1>
            <p className="page-subtitle">This queue appears once the Postgres import staging tables are live.</p>
          </div>
          <Link className="btn btn-primary" href="/">
            Back to dashboard
          </Link>
        </div>
        <div className="card">
          <div className="card-title">No Postgres data source</div>
          <p className="page-subtitle" style={{ margin: 0 }}>
            The CRM is still using local seed data in this session. Import review becomes available after the live database is configured.
          </p>
        </div>
      </div>
    );
  }

  if (authRequired) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <span className="badge badge-medium" style={{ padding: '4px 10px', marginBottom: 8 }}>
              <Lock size={14} />
              Admin Guard
            </span>
            <h1 className="page-title">Unlock import review</h1>
            <p className="page-subtitle">
              Import review contains staged customer data and requires either import-review permission or the temporary admin token.
            </p>
          </div>
          <Link className="btn btn-primary" href="/">
            Back to dashboard
          </Link>
        </div>
        <form className="card" onSubmit={unlockAdminSession} style={{ maxWidth: 520 }}>
          <div className="card-title">Admin token</div>
          <p className="page-subtitle">
            If your account does not have import-review access yet, enter the temporary AIT_CRM_ADMIN_TOKEN value.
          </p>
          <input
            className="input"
            type="password"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
            autoComplete="current-password"
            placeholder="Temporary admin token"
            style={{ marginBottom: 12 }}
          />
          <button className="btn btn-primary" disabled={!adminToken.trim() || saving} type="submit">
            <Lock size={16} />
            Unlock review queue
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="badge badge-contacted" style={{ padding: '4px 10px' }}>
              <Database size={14} />
              Import Review
            </span>
            <span className={`badge ${badgeClassForStatus(batch?.status || 'pending')}`}>
              {batch?.status || 'pending'}
            </span>
          </div>
          <h1 className="page-title">Approve staged rows inside the CRM</h1>
          <p className="page-subtitle" style={{ maxWidth: 760 }}>
            Review raw workbook rows, inspect the proposed normalized record, and approve or reject them without leaving the app.
          </p>
        </div>
        <div className="flex-gap" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setReloadKey((key) => key + 1)} disabled={loading || saving}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <Link className="btn btn-primary" href="/">
            Back to dashboard
          </Link>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <div className="card-title" style={{ color: 'var(--danger)', marginBottom: 8 }}>
            Review queue unavailable
          </div>
          <p className="page-subtitle" style={{ margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {summary && (
        <section className="import-cockpit" aria-label="Import decision summary">
          <div className="audit-banner">
            <div>
              <div className="audit-kicker">Batch confidence</div>
              <div className="audit-title">
                {batch?.businessUnitName || 'Unassigned'} · {batch?.fileName || batch?.sourceName || 'Latest import batch'}
              </div>
              <div className="audit-copy">
                {summary.counts.sourceRows.toLocaleString()} source rows · {summary.counts.normalizedRecords.toLocaleString()} normalized records · {leadOutcomeCount.toLocaleString()} lead decisions
              </div>
            </div>
            <div className="audit-meta">
              <span className={`badge ${badgeClassForStatus(batch?.status || 'pending')}`}>{batch?.status || 'pending'}</span>
              <span className="badge badge-contacted">{summary.counts.reviewItems.toLocaleString()} review items</span>
              {!batchHasBusinessUnit && (
                <span className="business-unit-warning">
                  <AlertTriangle size={14} />
                  Approval disabled: no division
                </span>
              )}
            </div>
          </div>

          <div className="outcome-grid">
            {OUTCOME_BUCKETS.map((bucket) => {
              const count = qualityCount(summary, bucket.value);
              return (
                <button
                  className={`outcome-card ${bucket.className} ${filters.quality === bucket.value ? 'outcome-card-active' : ''}`}
                  key={bucket.value}
                  type="button"
                  data-tooltip={bucket.description}
                  onClick={() => setFilters((prev) => ({ ...prev, quality: bucket.value, type: 'lead', offset: 0 }))}
                >
                  <span className="outcome-card-label">
                    {bucket.label}
                    <HelpCircle size={14} />
                  </span>
                  <strong>{count.toLocaleString()}</strong>
                  <span>{formatPercent(count, leadOutcomeCount)} of lead decisions</span>
                </button>
              );
            })}
          </div>

          <div className="secondary-strip" aria-label="Overlapping quality flags">
            {SECONDARY_BUCKETS.map((bucket) => {
              const count = qualityCount(summary, bucket.value);
              return (
                <button
                  className={`secondary-chip ${filters.quality === bucket.value ? 'secondary-chip-active' : ''}`}
                  key={bucket.value}
                  type="button"
                  data-tooltip={bucket.description}
                  onClick={() => setFilters((prev) => ({ ...prev, quality: bucket.value, type: 'lead', offset: 0 }))}
                >
                  <span>{bucket.label}</span>
                  <strong>{count.toLocaleString()}</strong>
                </button>
              );
            })}
            {filters.quality !== 'all' && (
              <button
                className="secondary-chip clear-chip"
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, quality: 'all', offset: 0 }))}
              >
                Clear quality filter
              </button>
            )}
          </div>

          <div className="decision-breakdowns">
            <div className="breakdown-panel">
              <div className="breakdown-head">
                <div>
                  <div className="card-title">Why needs review?</div>
                  <p className="page-subtitle">Action buckets for the unresolved lead queue.</p>
                </div>
                <span className="badge badge-medium">{qualityCount(summary, 'needs_review').toLocaleString()} total</span>
              </div>
              <div className="bucket-list">
                {needsReviewReasons.map((item) => (
                  <div className="bucket-row" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.count.toLocaleString()}</strong>
                  </div>
                ))}
                {!needsReviewReasons.length && <div className="bucket-empty">No needs-review lead buckets found.</div>}
              </div>
            </div>

            <div className="breakdown-panel">
              <div className="breakdown-head">
                <div>
                  <div className="card-title">Suppress reasons</div>
                  <p className="page-subtitle">Dead-lead reasons to spot rule gaps quickly.</p>
                </div>
                <span className="badge badge-lost">{qualityCount(summary, 'suppress_from_follow_up').toLocaleString()} total</span>
              </div>
              <div className="bucket-list">
                {suppressReasons.map((item) => (
                  <div className="bucket-row" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.count.toLocaleString()}</strong>
                  </div>
                ))}
                {!suppressReasons.length && <div className="bucket-empty">No suppress buckets found.</div>}
              </div>
            </div>

            <div className="breakdown-panel">
              <div className="breakdown-head">
                <div>
                  <div className="card-title">Review by sheet</div>
                  <p className="page-subtitle">Where the unresolved rows came from.</p>
                </div>
                <span className="badge badge-pending">{needsReviewSheetMix.length.toLocaleString()} sheets</span>
              </div>
              <div className="bucket-list">
                {needsReviewSheetMix.map((item) => {
                  const total = qualityCount(summary, 'needs_review');
                  return (
                    <div className="sheet-row" key={item.label}>
                      <div className="bucket-row">
                        <span>{item.label}</span>
                        <strong>{item.count.toLocaleString()}</strong>
                      </div>
                      <div className="sheet-bar" aria-hidden="true">
                        <span style={{ width: formatPercent(item.count, total) }} />
                      </div>
                    </div>
                  );
                })}
                {!needsReviewSheetMix.length && <div className="bucket-empty">No needs-review sheet mix found.</div>}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="review-toolbar">
          <div className="review-filters">
            <div className="review-search">
              <Search size={16} />
              <input
                className="input review-search-input"
                value={filters.q}
                onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value, offset: 0 }))}
                placeholder="Search sheet, raw text, type, or status"
              />
            </div>
            <select
              className="input select"
              value={filters.businessUnitId}
              onChange={(e) => setFilters((prev) => ({ ...prev, businessUnitId: e.target.value, batchId: '', offset: 0 }))}
              style={{ width: 190 }}
            >
              <option value="all">All divisions</option>
              {(businessUnits || []).map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            <select
              className="input select"
              value={filters.batchId}
              onChange={(e) => setFilters((prev) => ({ ...prev, batchId: e.target.value, offset: 0 }))}
              style={{ width: 300 }}
            >
              <option value="">Latest matching batch</option>
              {batches.map((option) => (
                <option key={option.id} value={option.id}>
                  {batchLabel(option)}
                </option>
              ))}
            </select>
            <select
              className="input select"
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, offset: 0 }))}
              style={{ width: 170 }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="input select"
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value, offset: 0 }))}
              style={{ width: 190 }}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="input select"
              value={filters.quality}
              onChange={(e) => setFilters((prev) => ({ ...prev, quality: e.target.value, type: e.target.value === 'all' ? prev.type : 'lead', offset: 0 }))}
              style={{ width: 220 }}
            >
              {QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="input select"
              value={filters.limit}
              onChange={(e) => setFilters((prev) => ({ ...prev, limit: Number(e.target.value), offset: 0 }))}
              style={{ width: 120 }}
            >
              {[60, 120, 180, 250].map((value) => (
                <option key={value} value={value}>
                  {value} rows
                </option>
              ))}
            </select>
          </div>
          <div className="review-actions">
            <button className="btn" onClick={() => setSelectedIds(allVisibleSelected ? [] : rowIds)}>
              <Filter size={16} />
              {allVisibleSelected ? 'Clear selection' : 'Select all visible'}
            </button>
            <button className="btn btn-primary" disabled={!canApproveRows || selectedCount === 0 || saving} onClick={() => updateRows(selectedIds, 'approved')}>
              <Check size={16} />
              Approve selected ({selectedCount})
            </button>
            <button className="btn btn-danger" disabled={!canReview || selectedCount === 0 || saving} onClick={() => updateRows(selectedIds, 'rejected')}>
              <X size={16} />
              Reject selected ({selectedCount})
            </button>
          </div>
        </div>
      </div>

      <div className="review-layout">
        <div className="card review-list">
          <div className="review-list-header">
            <div>
              <div className="card-title" style={{ marginBottom: 4 }}>Staged rows</div>
              <p className="page-subtitle" style={{ margin: 0 }}>
                {loading ? 'Loading review queue…' : `Showing ${pageRowsLabel} rows from ${batch?.fileName || 'the latest batch'}`}
              </p>
            </div>
            <div className="pagination-actions">
              <button className="btn btn-sm" disabled={loading || !pagination.hasPreviousPage} onClick={goToPreviousPage}>
                Previous
              </button>
              <span className="badge badge-pending">{selectedCount.toLocaleString()} selected</span>
              <button className="btn btn-sm" disabled={loading || !pagination.hasNextPage} onClick={goToNextPage}>
                Next
              </button>
            </div>
          </div>

          <div className="review-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(e) => setSelectedIds(e.target.checked ? rowIds : [])}
                    />
                  </th>
                  <th>Source</th>
                  <th>CRM record</th>
                  <th>Status</th>
                  <th>Confidence</th>
                  <th>Preview</th>
                  <th style={{ width: 220 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isActive = row.id === activeId;
                  const isSelected = selectedIds.includes(row.id);
                  const sheetContext = sheetContextForRow(row);
                  const quality = qualityForRow(row);
                  return (
                    <tr
                      key={row.id}
                      className={isActive ? 'review-row review-row-active' : 'review-row'}
                      onClick={() => setActiveId(row.id)}
                    >
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds((prev) => [...new Set([...prev, row.id])]);
                            else setSelectedIds((prev) => prev.filter((id) => id !== row.id));
                          }}
                        />
                      </td>
                      <td>
                        <div className="source-context">{sheetContext.label}</div>
                        <div style={{ fontWeight: 600 }}>{row.source_sheet}</div>
                        <div className="page-subtitle" style={{ margin: 0 }}>Row {row.source_row_number}</div>
                      </td>
                      <td>
                        <span className="badge badge-contacted">{labelForType(row.record_type)}</span>
                        <span className="badge badge-pending" style={{ marginLeft: 6 }}>
                          {businessUnitForRow(row, batch)}
                        </span>
                        {quality.disposition && (
                          <span className={`badge ${qualityBadgeClass(quality.disposition)}`} style={{ marginLeft: 6 }}>
                            {qualityLabel(quality.disposition)}
                          </span>
                        )}
                        {proposalForRow(row).paymentHint && row.record_type !== 'payment_snapshot' && (
                          <span className="badge badge-medium" style={{ marginLeft: 6 }}>Has payment fields</span>
                        )}
                        {quality.flags.length > 0 && (
                          <div className="quality-tags">
                            {quality.flags.slice(0, 3).map((flag) => (
                              <span className="quality-tag" key={flag.code || flag.label}>{flag.label || flag.code}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${badgeClassForStatus(row.status)}`}>{row.status}</span>
                      </td>
                      <td>{formatConfidence(row.confidenceScore)}</td>
                      <td>
                        <div className="review-preview">
                          {row.raw_text || 'No raw text captured.'}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="review-row-actions">
                          <button className="btn btn-sm" onClick={() => setActiveId(row.id)}>
                            <Eye size={14} />
                            Inspect
                          </button>
                          <button className="btn btn-sm btn-primary" disabled={!canApproveRows || saving} onClick={() => updateRows([row.id], 'approved')}>
                            <Check size={14} />
                            Approve
                          </button>
                          <button className="btn btn-sm btn-danger" disabled={!canReview || saving} onClick={() => updateRows([row.id], 'rejected')}>
                            <X size={14} />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && rows.length === 0 && (
              <div className="empty-state" style={{ padding: 40 }}>
                No rows match the current filters.
              </div>
            )}
          </div>
        </div>

        <div className="card review-detail">
          <div className="review-detail-head">
            <div>
              <div className="card-title" style={{ marginBottom: 4 }}>Selected row</div>
              <p className="page-subtitle" style={{ margin: 0 }}>
                Row-level approval happens here.
              </p>
            </div>
            {activeRow && <span className={`badge ${badgeClassForStatus(activeRow.status)}`}>{activeRow.status}</span>}
          </div>

          {activeRow ? (
            <>
              <div className="review-detail-meta">
                <div>
                  <div className="review-meta-label">Sheet</div>
                  <div>{activeRow.source_sheet}</div>
                </div>
                <div>
                  <div className="review-meta-label">Target division</div>
                  <div>{businessUnitForRow(activeRow, batch)}</div>
                </div>
                <div>
                  <div className="review-meta-label">Source lane</div>
                  <div>{sheetContextForRow(activeRow).label}</div>
                </div>
                <div>
                  <div className="review-meta-label">Row</div>
                  <div>{activeRow.source_row_number}</div>
                </div>
                <div>
                  <div className="review-meta-label">Type</div>
                  <div>{labelForType(activeRow.record_type)}</div>
                </div>
                <div>
                  <div className="review-meta-label">Confidence</div>
                  <div>{formatConfidence(activeRow.confidenceScore)}</div>
                </div>
                <div>
                  <div className="review-meta-label">Loaded</div>
                  <div>{formatDate(activeRow.created_at)}</div>
                </div>
              </div>

              {qualityForRow(activeRow).disposition && (
                <div className="detail-section">
                  <div className="review-meta-label">Lead quality</div>
                  <div className="quality-panel">
                    <span className={`badge ${qualityBadgeClass(qualityForRow(activeRow).disposition)}`}>
                      {qualityLabel(qualityForRow(activeRow).disposition)}
                    </span>
                    {qualityForRow(activeRow).contactability?.status && (
                      <span className="quality-tag">{qualityForRow(activeRow).contactability.status.replace(/_/g, ' ')}</span>
                    )}
                    {qualityForRow(activeRow).flags.map((flag) => (
                      <span className="quality-tag" key={flag.code || flag.label}>{flag.label || flag.code}</span>
                    ))}
                    {qualityForRow(activeRow).sourceTags.slice(0, 6).map((tag) => (
                      <span className="quality-tag quality-tag-source" key={tag}>{tag.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="detail-section">
                <div className="review-meta-label">Interpretation</div>
                <div className="review-interpretation">{interpretationForRow(activeRow)}</div>
              </div>

              <div className="detail-section">
                <div className="review-meta-label">Raw text</div>
                <pre className="review-pre">{activeRow.raw_text || 'No raw text captured.'}</pre>
              </div>

              <div className="detail-section">
                <div className="review-meta-label">Proposed record</div>
                <div className="proposal-grid">
                  {[
                    ['Lead', activeRow.proposed_lead_json],
                    ['Estimate', activeRow.proposed_estimate_json],
                    ['Work order', activeRow.proposed_work_order_json],
                    ['Payment', activeRow.proposed_payment_json],
                    ['Note', activeRow.proposed_note_json],
                    ['Contact', activeRow.proposed_contact_json],
                  ].filter(([, value]) => summarizeJson(value).length > 0).map(([title, value]) => {
                    const entries = summarizeJson(value);
                    return (
                      <div className="proposal-box" key={title}>
                        <div className="proposal-title">{title}</div>
                        {entries.map(([key, v]) => (
                          <div className="proposal-row" key={key}>
                            <span>{key}</span>
                            <strong>{v}</strong>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {[
                    activeRow.proposed_contact_json,
                    activeRow.proposed_lead_json,
                    activeRow.proposed_estimate_json,
                    activeRow.proposed_work_order_json,
                    activeRow.proposed_payment_json,
                    activeRow.proposed_note_json,
                  ].every((value) => summarizeJson(value).length === 0) && (
                    <div className="proposal-empty" style={{ gridColumn: '1 / -1' }}>No proposed record data for this row.</div>
                  )}
                </div>
              </div>

              <div className="detail-section">
                <div className="review-meta-label">Review items</div>
                <div className="review-items">
                  {activeRow.reviewItems?.length ? (
                    activeRow.reviewItems.map((item, index) => (
                      <div className="review-item" key={`${item.review_type}-${index}`}>
                        <div className="review-item-head">
                          <span className="badge badge-pending">{item.review_type}</span>
                          <span className={`badge ${badgeClassForStatus(item.review_status)}`}>{item.review_status}</span>
                        </div>
                        <div className="review-item-reason">{item.reason}</div>
                      </div>
                    ))
                  ) : (
                    <div className="review-item-empty">No review items linked to this row.</div>
                  )}
                </div>
              </div>

              <div className="review-detail-actions">
                <button className="btn btn-primary" disabled={!canApproveRows || saving} onClick={() => updateRows([activeRow.id], 'approved')}>
                  <Check size={16} />
                  Approve row
                </button>
                <button className="btn btn-danger" disabled={!canReview || saving} onClick={() => updateRows([activeRow.id], 'rejected')}>
                  <X size={16} />
                  Reject row
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ minHeight: 420 }}>
              Select a staged row to inspect the raw workbook text and proposed CRM payload.
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .import-cockpit {
          display: grid;
          gap: 14px;
          margin-bottom: 16px;
        }
        .audit-banner {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 18px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: linear-gradient(135deg, var(--bg-primary), var(--bg-tertiary));
        }
        .audit-kicker {
          color: var(--text-muted);
          font-size: var(--text-xs);
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .audit-title {
          color: var(--text-primary);
          font-size: var(--text-xl);
          font-weight: 800;
          line-height: 1.2;
        }
        .audit-copy {
          color: var(--text-secondary);
          font-size: var(--text-sm);
          margin-top: 5px;
        }
        .audit-meta {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 220px;
        }
        .outcome-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .outcome-card {
          display: grid;
          gap: 6px;
          min-height: 118px;
          padding: 15px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          color: var(--text-secondary);
          text-align: left;
          cursor: pointer;
          transition: border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
        }
        .outcome-card:hover,
        .outcome-card-active {
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }
        .outcome-card-label {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-secondary);
          font-size: var(--text-sm);
          font-weight: 800;
        }
        .outcome-card strong {
          color: var(--text-primary);
          font-size: var(--text-3xl);
          line-height: 1;
        }
        .outcome-ready:hover,
        .outcome-ready.outcome-card-active {
          border-color: var(--success);
        }
        .outcome-review:hover,
        .outcome-review.outcome-card-active {
          border-color: var(--warning);
        }
        .outcome-suppress:hover,
        .outcome-suppress.outcome-card-active {
          border-color: var(--danger);
        }
        .secondary-strip {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 10px 12px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
        }
        .secondary-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 32px;
          padding: 5px 9px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          background: var(--bg-primary);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: 800;
          cursor: pointer;
        }
        .secondary-chip strong {
          color: var(--text-primary);
          font-size: var(--text-sm);
        }
        .secondary-chip-active {
          border-color: var(--accent);
          background: var(--accent-muted);
          color: var(--accent);
        }
        .clear-chip {
          color: var(--text-muted);
        }
        .decision-breakdowns {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .breakdown-panel {
          min-width: 0;
          padding: 15px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
        }
        .breakdown-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          padding-bottom: 12px;
          margin-bottom: 12px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .breakdown-head .page-subtitle {
          margin: 3px 0 0;
          font-size: var(--text-xs);
        }
        .bucket-list {
          display: grid;
          gap: 9px;
        }
        .bucket-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: var(--text-secondary);
          font-size: var(--text-sm);
        }
        .bucket-row span {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .bucket-row strong {
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
        .bucket-empty {
          color: var(--text-muted);
          font-size: var(--text-sm);
        }
        .sheet-row {
          display: grid;
          gap: 5px;
        }
        .sheet-bar {
          height: 5px;
          overflow: hidden;
          border-radius: var(--radius-sm);
          background: var(--bg-tertiary);
        }
        .sheet-bar span {
          display: block;
          height: 100%;
          min-width: 4px;
          border-radius: inherit;
          background: var(--accent);
        }
        .review-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .review-filters {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          flex: 1;
        }
        .review-search {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: min(100%, 320px);
          flex: 1;
          padding: 0 12px;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-primary);
        }
        .review-search-input {
          border: none;
          background: transparent;
          padding-left: 0;
          box-shadow: none;
        }
        .review-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .business-unit-warning {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
          color: var(--danger);
          font-size: var(--text-xs);
          font-weight: 700;
        }
        .review-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.85fr);
          gap: 16px;
          align-items: start;
        }
        .review-list {
          padding: 0;
          overflow: hidden;
        }
        .review-list-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 18px 18px 14px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .pagination-actions {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .review-table {
          overflow: auto;
        }
        .review-table table th,
        .review-table table td {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-subtle);
          vertical-align: top;
          text-align: left;
          font-size: var(--text-sm);
        }
        .review-table table th {
          color: var(--text-muted);
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0;
          font-weight: 700;
          background: var(--bg-tertiary);
        }
        .review-row {
          cursor: pointer;
          transition: background var(--transition-fast);
        }
        .review-row:hover {
          background: var(--bg-hover);
        }
        .review-row-active {
          background: var(--accent-muted);
        }
        .review-preview {
          max-width: 460px;
          color: var(--text-secondary);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .source-context {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          padding: 2px 7px;
          margin-bottom: 5px;
          border-radius: var(--radius-sm);
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: 700;
        }
        .quality-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 7px;
          max-width: 280px;
        }
        .quality-tag {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          min-height: 20px;
          padding: 2px 7px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          font-weight: 700;
          text-transform: capitalize;
          line-height: 1.2;
        }
        .quality-panel {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
        }
        .quality-tag-source {
          text-transform: none;
          color: var(--text-muted);
        }
        .review-row-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .review-detail {
          min-height: 100%;
        }
        .review-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }
        .review-detail-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px 16px;
          padding: 14px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          margin-bottom: 16px;
        }
        .review-meta-label {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0;
          color: var(--text-muted);
          margin-bottom: 4px;
          font-weight: 700;
        }
        .detail-section {
          margin-bottom: 16px;
        }
        .review-interpretation {
          padding: 12px 14px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          font-size: var(--text-sm);
          line-height: 1.5;
        }
        .review-pre {
          margin-top: 8px;
          padding: 14px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: var(--text-sm);
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 220px;
          overflow: auto;
        }
        .proposal-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 8px;
        }
        .proposal-box {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          padding: 12px;
        }
        .proposal-title {
          font-size: var(--text-sm);
          font-weight: 700;
          margin-bottom: 8px;
        }
        .proposal-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 4px 0;
          font-size: var(--text-sm);
          border-bottom: 1px solid rgba(0, 0, 0, 0.02);
        }
        .proposal-row:last-child {
          border-bottom: none;
        }
        .proposal-row span {
          color: var(--text-muted);
          text-transform: capitalize;
        }
        .proposal-row strong {
          text-align: right;
          max-width: 55%;
          word-break: break-word;
          font-weight: 600;
        }
        .proposal-empty,
        .review-item-empty {
          color: var(--text-muted);
          font-size: var(--text-sm);
        }
        .review-items {
          display: grid;
          gap: 10px;
        }
        .review-item {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          background: var(--bg-primary);
          padding: 12px;
        }
        .review-item-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 8px;
        }
        .review-item-reason {
          font-size: var(--text-sm);
          color: var(--text-secondary);
          line-height: 1.45;
        }
        .review-detail-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 18px;
        }
        @media (max-width: 1180px) {
          .outcome-grid,
          .decision-breakdowns {
            grid-template-columns: 1fr;
          }
          .review-layout {
            grid-template-columns: 1fr;
          }
          .proposal-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 900px) {
          .audit-banner {
            flex-direction: column;
          }
          .audit-meta {
            justify-content: flex-start;
            min-width: 0;
          }
          .review-detail-meta {
            grid-template-columns: 1fr;
          }
          .review-toolbar {
            flex-direction: column;
            align-items: stretch;
          }
          .review-actions {
            justify-content: flex-start;
          }
          .review-filters {
            flex-direction: column;
            align-items: stretch;
          }
          .review-search {
            min-width: 0;
          }
          .review-table table {
            min-width: 980px;
          }
        }
      `}</style>
    </div>
  );
}
