'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  MessageSquare,
  RefreshCcw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { useCRM } from '@/lib/store';

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

function countFor(rows = [], status) {
  return rows
    .filter((row) => row.delivery_status === status || row.deliveryStatus === status || row.status === status)
    .reduce((sum, row) => sum + Number(row.count || 0), 0);
}

function StatusBadge({ state }) {
  const normalized = String(state || '').toLowerCase();
  const className = normalized === 'ready' || normalized === 'sent' || normalized === 'created'
    ? 'badge badge-completed'
    : normalized === 'mixed' || normalized === 'pending' || normalized === 'blocked'
      ? 'badge badge-pending'
      : normalized === 'missing' || normalized === 'inactive' || normalized === 'failed'
        ? 'badge badge-overdue'
        : 'badge badge-draft';
  return <span className={className}>{titleCase(normalized || 'unknown')}</span>;
}

function MetricCard({ icon: Icon, label, value, detail, state = 'default' }) {
  const color = state === 'bad' ? 'var(--danger)' : state === 'warn' ? 'var(--warning)' : state === 'good' ? 'var(--success)' : 'var(--accent)';
  return (
    <div className="card" style={{display:'flex',gap:12,alignItems:'flex-start'}}>
      <div style={{width:34,height:34,borderRadius:'var(--radius-md)',display:'grid',placeItems:'center',background:'var(--bg-tertiary)',color}}>
        <Icon size={18} />
      </div>
      <div style={{minWidth:0}}>
        <div style={{fontSize:'var(--text-xs)',color:'var(--text-secondary)',fontWeight:700,textTransform:'uppercase'}}>{label}</div>
        <div style={{fontSize:'var(--text-2xl)',fontWeight:750,lineHeight:1.2}}>{value}</div>
        {detail && <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',lineHeight:1.35,marginTop:4}}>{detail}</div>}
      </div>
    </div>
  );
}

function ChannelPanel({ channel, inboundRows = [], channelConfig, settings }) {
  const received = countFor(inboundRows, 'received');
  const configState = channelConfig?.status || 'missing';
  const effectiveSetting = settings?.effectiveScoped || settings?.organizationDefault || {};
  const blockers = [
    ...(configState === 'ready' ? [] : [`channel_config_${configState}`]),
    ...(effectiveSetting.blockers || []),
  ];

  return (
    <div className="card">
      <div className="flex-between" style={{gap:12,alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div className="card-title" style={{marginBottom:4}}>{titleCase(channel)} Inbound</div>
          <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>{received} received messages</div>
        </div>
        <StatusBadge state={blockers.length ? 'blocked' : 'ready'} />
      </div>
      <div style={{display:'grid',gap:8}}>
        <div className="flex-between"><span style={{color:'var(--text-secondary)'}}>Channel config</span><StatusBadge state={configState} /></div>
        <div className="flex-between"><span style={{color:'var(--text-secondary)'}}>Active provider accounts</span><strong>{channelConfig?.activeCount || 0}</strong></div>
        <div className="flex-between"><span style={{color:'var(--text-secondary)'}}>Settings enabled</span><strong>{effectiveSetting.enabled ? 'Yes' : 'No'}</strong></div>
        <div className="flex-between"><span style={{color:'var(--text-secondary)'}}>Enabled settings in scope</span><strong>{effectiveSetting.enabledScopedCount || 0} / {effectiveSetting.scopedCount || 0}</strong></div>
        <div className="flex-between"><span style={{color:'var(--text-secondary)'}}>Last inbound</span><strong>{formatDateTime(inboundRows[0]?.last_at)}</strong></div>
        {blockers.length > 0 && (
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:4}}>
            {blockers.map((code) => <span key={code} className="badge badge-overdue">{titleCase(code)}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderReadiness({ providerConfig }) {
  const blockers = providerConfig?.blockers || [];
  const rows = [
    ['Webhook verify token', providerConfig?.webhook?.verifyTokenConfigured],
    ['Webhook app secret', providerConfig?.webhook?.appSecretConfigured],
    ['Messenger token', providerConfig?.messenger?.defaultAccessTokenConfigured || providerConfig?.messenger?.mappedAccessTokens?.entryCount > 0],
    ['WhatsApp token', providerConfig?.whatsapp?.defaultAccessTokenConfigured || providerConfig?.whatsapp?.mappedAccessTokens?.entryCount > 0],
    ['WhatsApp BU map', providerConfig?.whatsapp?.businessUnitMap?.entryCount > 0],
  ];

  return (
    <div className="card">
      <div className="flex-between" style={{gap:12,alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div className="card-title" style={{marginBottom:4}}>Provider Readiness</div>
          <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>Secret values are never displayed.</div>
        </div>
        <StatusBadge state={blockers.length ? 'blocked' : 'ready'} />
      </div>
      <div style={{display:'grid',gap:8}}>
        {rows.map(([label, ok]) => (
          <div key={label} className="flex-between">
            <span style={{color:'var(--text-secondary)'}}>{label}</span>
            <span className={`badge ${ok ? 'badge-completed' : 'badge-overdue'}`}>{ok ? 'Configured' : 'Missing'}</span>
          </div>
        ))}
      </div>
      {blockers.length > 0 && (
        <div style={{display:'grid',gap:6,marginTop:12}}>
          {blockers.map((blocker) => (
            <div key={blocker.code} style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>
              <strong style={{color:'var(--danger)'}}>{titleCase(blocker.code)}:</strong> {blocker.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ManualOutboundPanel({ manualOutbound }) {
  const rows = Object.values(manualOutbound?.byStatus || {}).flat();
  const pending = countFor(rows, 'pending');
  const sent = countFor(rows, 'sent');
  const failed = countFor(rows, 'failed');
  const metrics = [
    ['Pending', pending, 'badge-pending'],
    ['Sent', sent, 'badge-completed'],
    ['Failed', failed, 'badge-overdue'],
  ];
  return (
    <div className="card">
      <div className="card-title">Manual Outbound Audit</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8,marginBottom:14}}>
        {metrics.map(([label, value, badgeClass]) => (
          <div key={label} style={{padding:'10px 12px',border:'1px solid var(--border-subtle)',borderRadius:'var(--radius-md)',background:'var(--bg-tertiary)'}}>
            <div style={{fontSize:'var(--text-xs)',fontWeight:700,color:'var(--text-secondary)',textTransform:'uppercase'}}>{label}</div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:4}}>
              <strong style={{fontSize:'var(--text-xl)'}}>{value}</strong>
              <span className={`badge ${badgeClass}`}>{value}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gap:8}}>
        {(manualOutbound?.failures || []).slice(0, 8).map((failure) => (
          <div key={`${failure.channel}-${failure.code}`} className="flex-between" style={{gap:10}}>
            <span style={{color:'var(--text-secondary)'}}>{titleCase(failure.channel)} / {titleCase(failure.code)}</span>
            <span className="badge badge-overdue">{failure.count}</span>
          </div>
        ))}
        {!(manualOutbound?.failures || []).length && <div style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>No recent manual-send failures.</div>}
      </div>
    </div>
  );
}

function TemplatePanel({ templates }) {
  const blocked = (templates?.templates || []).filter((template) => template.blockers?.length);
  return (
    <div className="card">
      <div className="flex-between" style={{gap:12,alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div className="card-title" style={{marginBottom:4}}>Templates & Settings</div>
          <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)'}}>
            {templates?.summary?.enabled || 0} enabled of {templates?.summary?.total || 0}
          </div>
        </div>
        <StatusBadge state={blocked.length ? 'blocked' : 'ready'} />
      </div>
      <div style={{display:'grid',gap:8}}>
        {blocked.slice(0, 10).map((template) => (
          <div key={template.id} style={{borderTop:'1px solid var(--border-subtle)',paddingTop:8}}>
            <div className="flex-between" style={{gap:10}}>
              <strong style={{fontSize:'var(--text-sm)'}}>{template.displayName}</strong>
              <span className="badge badge-draft">{titleCase(template.channel)}</span>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
              {template.blockers.map((blocker) => <span key={blocker} className="badge badge-overdue">{titleCase(blocker)}</span>)}
            </div>
          </div>
        ))}
        {!blocked.length && <div style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>No blocked templates in scope.</div>}
      </div>
    </div>
  );
}

function FollowUpPanel({ followUps }) {
  const blockers = followUps?.blockers || [];
  const runRows = followUps?.runs || [];
  return (
    <div className="card">
      <div className="card-title">Follow-up Sequence Runs</div>
      <div style={{display:'grid',gap:8,marginBottom:14}}>
        {runRows.map((row) => (
          <div key={row.status} className="flex-between">
            <span style={{color:'var(--text-secondary)'}}>{titleCase(row.status)}</span>
            <span className="badge badge-inprogress">{row.count}</span>
          </div>
        ))}
        {!runRows.length && <div style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>No sequence runs recorded yet.</div>}
      </div>
      <div style={{fontSize:'var(--text-xs)',fontWeight:700,color:'var(--text-secondary)',textTransform:'uppercase',marginBottom:8}}>Blocked Reasons</div>
      <div style={{display:'grid',gap:8}}>
        {blockers.slice(0, 8).map((blocker) => (
          <div key={blocker.codes.join(',') || 'none'} className="flex-between" style={{gap:10}}>
            <span style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {blocker.codes.map((code) => <span key={code} className="badge badge-overdue">{titleCase(code)}</span>)}
            </span>
            <strong>{blocker.count}</strong>
          </div>
        ))}
        {!blockers.length && <div style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>No blocked sequence runs.</div>}
      </div>
    </div>
  );
}

function RecentEvents({ snapshot }) {
  const events = [
    ...(snapshot?.inbound?.recent || []).map((row) => ({ kind: 'Inbound', channel: row.channel, status: row.deliveryStatus, at: row.occurredAt, detail: row.idempotencyKeyHash })),
    ...(snapshot?.manualOutbound?.pendingOrFailed || []).map((row) => ({ kind: 'Manual outbound', channel: row.channel, status: row.deliveryStatus, at: row.updatedAt, detail: row.error?.code || row.idempotencyKeyHash })),
    ...(snapshot?.followUps?.recentRuns || []).map((row) => ({ kind: 'Follow-up run', channel: '', status: row.status, at: row.updatedAt || row.createdAt, detail: row.blockedReasons?.join(', ') || row.taskId || row.id })),
  ].sort((left, right) => String(right.at || '').localeCompare(String(left.at || ''))).slice(0, 16);

  return (
    <div className="card">
      <div className="card-title">Recent Redacted Events</div>
      <div style={{display:'grid',gap:8}}>
        {events.map((event, index) => (
          <div key={`${event.kind}-${event.at}-${index}`} className="flex-between" style={{gap:10,borderTop:index ? '1px solid var(--border-subtle)' : 'none',paddingTop:index ? 8 : 0}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:650,fontSize:'var(--text-sm)'}}>{event.kind} {event.channel ? `/ ${titleCase(event.channel)}` : ''}</div>
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',overflowWrap:'anywhere'}}>{event.detail || 'No detail'}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <StatusBadge state={event.status} />
              <div style={{fontSize:'var(--text-xs)',color:'var(--text-muted)',marginTop:3}}>{formatDateTime(event.at)}</div>
            </div>
          </div>
        ))}
        {!events.length && <div style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>No comms events recorded in scope.</div>}
      </div>
    </div>
  );
}

export default function CommsOpsPage() {
  const { loaded, access, dataSource } = useCRM();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(dataSource === 'postgres');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (dataSource !== 'postgres' || !access.canReadSettings) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/comms/observability', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Comms observability could not load.');
      setSnapshot(payload);
    } catch (err) {
      setError(err.message || 'Comms observability could not load.');
    } finally {
      setLoading(false);
    }
  }, [access.canReadSettings, dataSource]);

  useEffect(() => {
    if (!loaded) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, refresh]);

  const topLine = useMemo(() => {
    const providerBlockers = snapshot?.providerConfig?.blockers?.length || 0;
    const contactBlockers = snapshot?.contactBlockers?.blockedContacts || 0;
    const templateBlockers = snapshot?.templates?.summary?.blocked || 0;
    const followUpBlockers = (snapshot?.followUps?.blockers || []).reduce((sum, row) => sum + Number(row.count || 0), 0);
    return { providerBlockers, contactBlockers, templateBlockers, followUpBlockers };
  }, [snapshot]);

  if (!loaded || !access.canReadSettings) return <div className="empty-state">Loading...</div>;
  if (dataSource !== 'postgres') return <div className="empty-state">Comms observability requires the Postgres-backed app.</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Comms Ops</h1>
          <p className="page-subtitle">Messenger, WhatsApp, templates, manual sends, and follow-up sequence health.</p>
        </div>
        <button className="btn" onClick={refresh} disabled={loading}>
          <RefreshCcw size={15} />
          <span>{loading ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </div>

      {error && <div className="card" style={{borderColor:'var(--danger)',color:'var(--danger)',marginBottom:16}}>{error}</div>}

      <div className="grid-4" style={{marginBottom:16}}>
        <MetricCard icon={ShieldCheck} label="Provider Blockers" value={topLine.providerBlockers} state={topLine.providerBlockers ? 'bad' : 'good'} />
        <MetricCard icon={AlertTriangle} label="DNC / Wrong #" value={topLine.contactBlockers} state={topLine.contactBlockers ? 'warn' : 'good'} />
        <MetricCard icon={MessageSquare} label="Template Blockers" value={topLine.templateBlockers} state={topLine.templateBlockers ? 'warn' : 'good'} />
        <MetricCard icon={Workflow} label="Run Blockers" value={topLine.followUpBlockers} state={topLine.followUpBlockers ? 'warn' : 'good'} />
      </div>

      {loading && !snapshot ? (
        <div className="empty-state">Loading comms diagnostics...</div>
      ) : (
        <>
          <div className="grid-3" style={{marginBottom:16}}>
            <ChannelPanel
              channel="messenger"
              inboundRows={snapshot?.inbound?.byStatus?.messenger || []}
              channelConfig={snapshot?.inbound?.channelConfigs?.messenger}
              settings={snapshot?.templates?.settings?.messenger}
            />
            <ChannelPanel
              channel="whatsapp"
              inboundRows={snapshot?.inbound?.byStatus?.whatsapp || []}
              channelConfig={snapshot?.inbound?.channelConfigs?.whatsapp}
              settings={snapshot?.templates?.settings?.whatsapp}
            />
            <ProviderReadiness providerConfig={snapshot?.providerConfig} />
          </div>

          <div className="grid-2" style={{marginBottom:16}}>
            <ManualOutboundPanel manualOutbound={snapshot?.manualOutbound} />
            <TemplatePanel templates={snapshot?.templates} />
          </div>

          <div className="grid-2" style={{marginBottom:16}}>
            <FollowUpPanel followUps={snapshot?.followUps} />
            <RecentEvents snapshot={snapshot} />
          </div>

          <div className="card">
            <div className="card-title">Runbook Notes</div>
            <div style={{display:'grid',gap:6,color:'var(--text-secondary)',fontSize:'var(--text-sm)',lineHeight:1.45}}>
              {(snapshot?.notes || []).map((note) => <div key={note}>{note}</div>)}
              <div>Full procedures live in <strong>docs/comms-observability-runbook.md</strong>.</div>
              <div>Generated at {formatDateTime(snapshot?.generatedAt)}.</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
