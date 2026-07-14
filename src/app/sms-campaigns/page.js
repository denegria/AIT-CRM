'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Megaphone,
  RefreshCcw,
  Save,
  Send,
  ShieldAlert,
} from 'lucide-react';
import PageState, { PageStateAction } from '@/components/PageState';
import { useCRM } from '@/lib/store';

const audienceSegments = [
  { key: 'all', label: 'All SMS Eligible', filters: {} },
  { key: 'active_leads', label: 'New + Follow-up Leads', filters: { leadStatuses: ['New Lead', 'Follow Up'] } },
  { key: 'retargeting', label: 'Retargeting', filters: { leadStatuses: ['Retargeting'] } },
];

function cleanText(value) {
  return String(value || '').trim();
}

function titleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value) {
  if (!value) return 'None';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'None';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function selectedBusinessUnitId({ currentBusinessUnitId, accessibleBusinessUnits }) {
  if (currentBusinessUnitId && !['all', 'unassigned'].includes(currentBusinessUnitId)) return currentBusinessUnitId;
  return accessibleBusinessUnits?.[0]?.id || '';
}

function defaultForm({ currentBusinessUnitId, accessibleBusinessUnits }) {
  return {
    businessUnitId: selectedBusinessUnitId({ currentBusinessUnitId, accessibleBusinessUnits }),
    name: `Retargeting SMS ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    audienceSegment: 'retargeting',
    messageBody: 'Hi {{first_name}}, AIT USA has new class openings. Reply YES and an advisor will help you pick the best schedule. Reply STOP to opt out.',
    senderProvider: 'telnyx',
    senderAccountId: '',
    throttlePerHour: 120,
  };
}

function audienceFiltersFor(segmentKey) {
  return audienceSegments.find((segment) => segment.key === segmentKey)?.filters || {};
}

function StatusBadge({ status }) {
  const value = String(status || 'draft').toLowerCase();
  const className = value === 'approved' || value === 'completed'
    ? 'badge badge-completed'
    : value === 'launch_blocked' || value === 'failed'
      ? 'badge badge-overdue'
      : value === 'scheduled' || value === 'running' || value === 'launching'
        ? 'badge badge-inprogress'
        : value === 'cancelled' || value === 'paused'
          ? 'badge badge-draft'
          : 'badge badge-pending';
  return <span className={className}>{titleCase(value)}</span>;
}

function Metric({ label, value, tone = 'default' }) {
  const color = tone === 'bad' ? 'var(--danger)' : tone === 'good' ? 'var(--success)' : 'var(--accent)';
  return (
    <div style={{padding:'10px 12px',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)',background:'var(--bg-tertiary)'}}>
      <div style={{fontSize:'var(--text-xs)',fontWeight:750,color:'var(--text-secondary)',textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:'var(--text-xl)',fontWeight:780,color,lineHeight:1.1,marginTop:4}}>{value}</div>
    </div>
  );
}

function BlockerList({ blockers = [] }) {
  if (!blockers.length) {
    return <span className="badge badge-completed">Ready</span>;
  }
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
      {blockers.map((blocker) => (
        <span key={blocker.code || blocker.message} className="badge badge-overdue" title={blocker.message}>
          {titleCase(blocker.code || blocker.message)}
        </span>
      ))}
    </div>
  );
}

function PreviewPanel({ preview, policy }) {
  if (!preview) {
    return (
      <div className="card">
        <div className="card-title">Audience Preview</div>
        <div style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>No preview loaded.</div>
      </div>
    );
  }

  const visibleRows = [...(preview.included || []), ...(preview.blocked || [])].slice(0, 12);
  return (
    <div className="card">
      <div className="flex-between" style={{gap:12,alignItems:'flex-start',marginBottom:14}}>
        <div>
          <div className="card-title" style={{marginBottom:4}}>Audience Preview</div>
          <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>
            {preview.total || 0} contacts evaluated
          </div>
        </div>
        <BlockerList blockers={policy?.blockers || []} />
      </div>
      <div className="grid-4" style={{marginBottom:14}}>
        <Metric label="Eligible" value={preview.includedCount || 0} tone="good" />
        <Metric label="Blocked" value={preview.blockedCount || 0} tone={preview.blockedCount ? 'bad' : 'good'} />
        <Metric label="Duplicates" value={preview.duplicateCount || 0} />
        <Metric label="Reasons" value={Object.keys(preview.reasonCounts || {}).length} />
      </div>
      <div style={{display:'grid',gap:8}}>
        {visibleRows.map((row, index) => (
          <div key={`${row.contactId || row.phone || index}-${index}`} style={{display:'grid',gridTemplateColumns:'minmax(0,0.8fr) minmax(0,1fr) auto',gap:10,alignItems:'start',padding:'10px 0',borderTop:index ? '1px solid var(--border-subtle)' : 'none'}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:700,overflowWrap:'anywhere'}}>{row.name || 'Unknown contact'}</div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',overflowWrap:'anywhere'}}>{row.phone || 'No phone'}</div>
            </div>
            <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)',lineHeight:1.35,overflowWrap:'anywhere'}}>
              {row.messagePreview || 'No message preview'}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',flexWrap:'wrap',gap:5}}>
              {row.ok ? (
                <span className="badge badge-completed">Included</span>
              ) : (
                (row.reasons || []).map((reason) => (
                  <span key={reason.code} className="badge badge-overdue" title={reason.message}>{titleCase(reason.code)}</span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SmsCampaignsPage() {
  const {
    loaded,
    access,
    dataSource,
    accessibleBusinessUnits,
    currentBusinessUnitId,
  } = useCRM();
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [form, setForm] = useState(() => defaultForm({ currentBusinessUnitId, accessibleBusinessUnits }));
  const [preview, setPreview] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(dataSource === 'postgres');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const formBusinessUnitId = form.businessUnitId || selectedBusinessUnitId({ currentBusinessUnitId, accessibleBusinessUnits });

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || campaigns[0] || null,
    [campaigns, selectedCampaignId],
  );

  const refreshCampaigns = useCallback(async () => {
    if (dataSource !== 'postgres' || !access.canReadCrm) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (currentBusinessUnitId && !['all', 'unassigned'].includes(currentBusinessUnitId)) {
        params.set('businessUnitId', currentBusinessUnitId);
      }
      const response = await fetch(`/api/sms-campaigns${params.size ? `?${params}` : ''}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'SMS campaigns could not load.');
      const rows = Array.isArray(payload.campaigns) ? payload.campaigns : [];
      setCampaigns(rows);
      setSelectedCampaignId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '');
    } catch (err) {
      setError(err.message || 'SMS campaigns could not load.');
    } finally {
      setLoading(false);
    }
  }, [access.canReadCrm, currentBusinessUnitId, dataSource]);

  useEffect(() => {
    if (!loaded) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) refreshCampaigns();
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, refreshCampaigns]);

  async function postCampaignAction(action, body = {}) {
    setBusyAction(action);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/sms-campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && !(action === 'launch' && response.status === 409)) {
        throw new Error(payload.error || 'SMS campaign action failed.');
      }
      return payload;
    } catch (err) {
      setError(err.message || 'SMS campaign action failed.');
      return null;
    } finally {
      setBusyAction('');
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    const payload = await postCampaignAction('create', {
      businessUnitId: formBusinessUnitId,
      name: form.name,
      audienceFilterJson: audienceFiltersFor(form.audienceSegment),
      messageBody: form.messageBody,
      senderProvider: form.senderProvider,
      senderAccountId: form.senderAccountId,
      throttlePerHour: form.throttlePerHour,
    });
    if (!payload) return;
    if (payload?.campaign?.id) {
      setSelectedCampaignId(payload.campaign.id);
      setNotice('Draft saved.');
      await refreshCampaigns();
    }
  }

  async function handlePreviewDraft() {
    const payload = await postCampaignAction('preview_draft', {
      businessUnitId: formBusinessUnitId,
      audienceFilterJson: audienceFiltersFor(form.audienceSegment),
      messageBody: form.messageBody,
      limit: 500,
    });
    if (!payload) return;
    setPreview(payload.preview || null);
    setPolicy(null);
  }

  async function handleCampaignAction(action) {
    if (!selectedCampaign) return;
    const payload = await postCampaignAction(action, {
      campaignId: selectedCampaign.id,
      limit: 500,
    });
    if (!payload) return;
    if (payload.preview) setPreview(payload.preview);
    if (payload.policy) setPolicy(payload.policy);
    if (payload.campaign?.id) setSelectedCampaignId(payload.campaign.id);
    await refreshCampaigns();
    if (action === 'launch') {
      setNotice(payload.policy?.blocked ? 'Launch blocked by readiness policy.' : 'Launch request accepted.');
    } else {
      setNotice(titleCase(action) + ' complete.');
    }
  }

  if (!loaded) {
    return <PageState tone="loading" title="Loading SMS campaigns" copy="Preparing campaign drafts and compliance readiness for your current division." />;
  }
  if (!access.canReadCrm) {
    return (
      <PageState
        tone="denied"
        title="SMS campaigns require CRM access"
        copy="Your account can keep using the CRM surfaces assigned to your role. Ask an administrator if campaign access is needed."
        actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
      />
    );
  }
  if (dataSource !== 'postgres') {
    return <PageState tone="denied" title="SMS campaigns require Postgres" copy="Campaign management is only available in the Postgres-backed CRM runtime." />;
  }

  const selectedBusinessUnit = accessibleBusinessUnits.find((unit) => unit.id === formBusinessUnitId);
  const canManageCampaigns = Boolean(access.canManageSmsCampaigns);

  if (!canManageCampaigns) {
    return (
      <PageState
        tone="denied"
        title="SMS campaigns require administrator access"
        copy="Campaign drafting and approval are restricted because they affect compliance and outbound messaging."
        actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
      />
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">SMS Campaigns</h1>
          <p className="page-subtitle">Draft, preview, approve, and audit retargeting SMS campaigns.</p>
        </div>
        <button type="button" className="btn" onClick={refreshCampaigns} disabled={loading}>
          <RefreshCcw size={15} />
          <span>{loading ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </div>

      {error && <div className="card" style={{borderColor:'var(--danger)',color:'var(--danger)',marginBottom:16}}>{error}</div>}
      {notice && <div className="card" style={{borderColor:'var(--success)',color:'var(--success)',marginBottom:16}}>{notice}</div>}

      <div className="sms-campaign-layout" style={{display:'grid',gridTemplateColumns:'minmax(320px,0.82fr) minmax(0,1.18fr)',gap:16,alignItems:'start'}}>
        <div style={{display:'grid',gap:16}}>
          <form className="card" onSubmit={handleCreate}>
            <div className="flex-between" style={{gap:12,alignItems:'flex-start',marginBottom:14}}>
              <div>
                <div className="card-title" style={{marginBottom:4}}>Draft</div>
                <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>{selectedBusinessUnit?.name || 'No division selected'}</div>
              </div>
              <Megaphone size={18} color="var(--accent)" />
            </div>
            <div className="form-group">
              <label className="form-label">Division</label>
              <select
                className="input select"
                value={formBusinessUnitId}
                onChange={(event) => setForm((current) => ({ ...current, businessUnitId: event.target.value }))}
                disabled={!canManageCampaigns}
              >
                {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Campaign Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                disabled={!canManageCampaigns}
              />
            </div>
            <div className="grid-2" style={{gap:10}}>
              <div className="form-group">
                <label className="form-label">Audience</label>
                <select
                  className="input select"
                  value={form.audienceSegment}
                  onChange={(event) => setForm((current) => ({ ...current, audienceSegment: event.target.value }))}
                  disabled={!canManageCampaigns}
                >
                  {audienceSegments.map((segment) => <option key={segment.key} value={segment.key}>{segment.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Hourly Throttle</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="5000"
                  value={form.throttlePerHour}
                  onChange={(event) => setForm((current) => ({ ...current, throttlePerHour: event.target.value }))}
                  disabled={!canManageCampaigns}
                />
              </div>
            </div>
            <div className="grid-2" style={{gap:10}}>
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select
                  className="input select"
                  value={form.senderProvider}
                  onChange={(event) => setForm((current) => ({ ...current, senderProvider: event.target.value }))}
                  disabled={!canManageCampaigns}
                >
                  <option value="telnyx">Telnyx</option>
                  <option value="bandwidth">Bandwidth</option>
                  <option value="twilio">Twilio</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Sender/Profile</label>
                <input
                  className="input"
                  value={form.senderAccountId}
                  onChange={(event) => setForm((current) => ({ ...current, senderAccountId: event.target.value }))}
                  placeholder="Staging sender id"
                  disabled={!canManageCampaigns}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Message Copy</label>
              <textarea
                className="input"
                rows={5}
                value={form.messageBody}
                onChange={(event) => setForm((current) => ({ ...current, messageBody: event.target.value }))}
                disabled={!canManageCampaigns}
                style={{resize:'vertical',lineHeight:1.45}}
              />
            </div>
            <div className="flex-gap">
              <button type="button" className="btn" onClick={handlePreviewDraft} disabled={!canManageCampaigns || busyAction === 'preview_draft' || !cleanText(formBusinessUnitId)}>
                <Eye size={15} />
                <span>{busyAction === 'preview_draft' ? 'Previewing' : 'Preview'}</span>
              </button>
              <button type="submit" className="btn btn-primary" disabled={!canManageCampaigns || busyAction === 'create' || !cleanText(formBusinessUnitId) || !cleanText(form.name) || !cleanText(form.messageBody)}>
                <Save size={15} />
                <span>{busyAction === 'create' ? 'Saving' : 'Save Draft'}</span>
              </button>
            </div>
          </form>

          <div className="card">
            <div className="card-title">Campaigns</div>
            <div style={{display:'grid',gap:8}}>
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSelectedCampaignId(campaign.id);
                    setPreview(null);
                    setPolicy(null);
                  }}
                  style={{justifyContent:'space-between',borderRadius:'var(--radius-md)',padding:'10px 12px',whiteSpace:'normal',textAlign:'left'}}
                >
                  <span style={{display:'grid',gap:3,minWidth:0}}>
                    <strong style={{overflowWrap:'anywhere'}}>{campaign.name}</strong>
                    <span style={{fontSize:'var(--text-xs)',color:'var(--text-muted)'}}>{formatDateTime(campaign.updatedAt)}</span>
                  </span>
                  <StatusBadge status={campaign.status} />
                </button>
              ))}
              {!campaigns.length && <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>No SMS campaigns in scope.</div>}
            </div>
          </div>
        </div>

        <div style={{display:'grid',gap:16}}>
          <div className="card">
            <div className="flex-between" style={{gap:12,alignItems:'flex-start',marginBottom:14}}>
              <div>
                <div className="card-title" style={{marginBottom:4}}>Selected Campaign</div>
                <div style={{fontWeight:760,fontSize:'var(--text-lg)',overflowWrap:'anywhere'}}>
                  {selectedCampaign?.name || 'None selected'}
                </div>
              </div>
              <StatusBadge status={selectedCampaign?.status} />
            </div>
            {selectedCampaign ? (
              <>
                <div className="grid-3" style={{marginBottom:14}}>
                  <Metric label="Provider" value={titleCase(selectedCampaign.senderProvider || 'telnyx')} />
                  <Metric label="Sender" value={selectedCampaign.senderAccountId || 'Missing'} tone={selectedCampaign.senderAccountId ? 'good' : 'bad'} />
                  <Metric label="Throttle" value={selectedCampaign.throttlePerHour || 0} />
                </div>
                <div style={{padding:'12px',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)',background:'var(--bg-tertiary)',fontSize:'var(--text-sm)',lineHeight:1.45,marginBottom:14,overflowWrap:'anywhere'}}>
                  {selectedCampaign.messageBody}
                </div>
                <div className="flex-gap">
                  <button type="button" className="btn" onClick={() => handleCampaignAction('preview')} disabled={busyAction === 'preview'}>
                    <Eye size={15} />
                    <span>Preview</span>
                  </button>
                  <button type="button" className="btn" onClick={() => handleCampaignAction('snapshot')} disabled={!canManageCampaigns || busyAction === 'snapshot'}>
                    <ClipboardCheck size={15} />
                    <span>Snapshot</span>
                  </button>
                  <button type="button" className="btn" onClick={() => handleCampaignAction('approve')} disabled={!canManageCampaigns || busyAction === 'approve'}>
                    <CheckCircle2 size={15} />
                    <span>Approve</span>
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => handleCampaignAction('launch')} disabled={!canManageCampaigns || busyAction === 'launch'}>
                    <Send size={15} />
                    <span>Launch Check</span>
                  </button>
                </div>
              </>
            ) : (
              <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Create or select a campaign.</div>
            )}
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="flex-between" style={{gap:10,alignItems:'flex-start'}}>
                <div>
                  <div className="card-title" style={{marginBottom:4}}>Launch Policy</div>
                  <BlockerList blockers={policy?.blockers || []} />
                </div>
                <ShieldAlert size={18} color={policy?.blocked ? 'var(--danger)' : 'var(--success)'} />
              </div>
            </div>
            <div className="card">
              <div className="flex-between" style={{gap:10,alignItems:'flex-start'}}>
                <div>
                  <div className="card-title" style={{marginBottom:4}}>Send Guard</div>
                  <span className="badge badge-overdue">Live Send Disabled</span>
                </div>
                <Ban size={18} color="var(--danger)" />
              </div>
            </div>
          </div>

          <PreviewPanel preview={preview} policy={policy} />
        </div>
      </div>

    </div>
  );
}
