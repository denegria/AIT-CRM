'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCRM } from '@/lib/store';
import PageState, { PageStateAction } from '@/components/PageState';

function dateInput(value) { return value.toISOString().slice(0, 10); }

export default function ReportsPage() {
  const { access, loaded, currentBusinessUnit, scopeLabel } = useCRM();
  const now = useMemo(() => new Date(), []);
  const [filters, setFilters] = useState({ from: dateInput(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: dateInput(now), source: 'all', coordinatorId: 'all', groupBy: 'source' });
  const [report, setReport] = useState(null); const [status, setStatus] = useState('idle'); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [reportQuery, setReportQuery] = useState('');
  const requestId = useRef(0);
  const query = useMemo(() => { const params = new URLSearchParams({ businessUnitId: currentBusinessUnit?.id || 'all', ...filters, page: String(page) }); return params.toString(); }, [currentBusinessUnit?.id, filters, page]);
  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    setStatus('loading');
    setError('');
    try {
      const response = await fetch(`/api/reports?${query}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Reports could not load.');
      if (currentRequest !== requestId.current) return;
      setReport(payload);
      setReportQuery(query);
      setStatus('ready');
    } catch (cause) {
      if (cause.name === 'AbortError' || currentRequest !== requestId.current) return;
      setError(cause.message);
      setStatus('error');
    }
    return () => controller.abort();
  }, [query]);
  // The report is an external data source keyed by the shared filter query.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (loaded && access.canReadReports) { load(); return () => { requestId.current += 1; }; } return undefined; }, [access.canReadReports, loaded, load]);
  const updateFilter = (key, value) => { setPage(1); setFilters((current) => ({ ...current, [key]: value })); };
  const exportCSV = async () => { if (!report || status === 'loading' || !reportQuery) return; const params = new URLSearchParams(reportQuery); params.set('format', 'csv'); params.set('asOf', report.filters.asOf); try { const response = await fetch(`/api/reports?${params.toString()}`, { cache: 'no-store' }); if (!response.ok) throw new Error('The filtered CSV could not be exported.'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ait-crm-lead-performance.csv'; anchor.click(); URL.revokeObjectURL(url); } catch (cause) { setError(cause.message); setStatus('error'); } };
  const resetFilters = () => { setPage(1); setFilters({ from: filters.from, to: filters.to, source: 'all', coordinatorId: 'all', groupBy: 'source' }); };
  if (!loaded) return <PageState tone="loading" title="Loading reports" copy="Preparing lead performance metrics for your current scope." />;
  if (!access.canReadReports) return <PageState tone="denied" title="Reports require reporting access" copy="Ask an administrator for reports access." actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>} />;
  const summary = report?.summary || { incoming: 0, contacted: 0, enrolled: 0, contactRate: 0, enrollmentRate: 0 };
  return <div className="fade-in reports-workspace">
    <div className="page-header"><div><h1 className="page-title">Lead performance</h1><p className="page-subtitle">Incoming leads, successful contact, and enrollment for {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p></div><div className="flex-gap"><button className="btn" onClick={exportCSV} disabled={!report?.leads?.length}>Export filtered CSV</button><button className="btn btn-primary" onClick={() => window.print()}>Print report</button></div></div>
    {status === 'error' && <div className="card reports-notice" role="alert"><strong>Reports could not load</strong><span>{error}</span><button className="btn btn-primary" onClick={load}>Try again</button></div>}
    <div className="card reports-filters"><div className="card-title">Report scope</div><div className="reports-filter-grid"><label>Lead date from<input className="input" type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /></label><label>Lead date to<input className="input" type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} /></label><label>Source<select className="input select" value={filters.source} onChange={(event) => updateFilter('source', event.target.value)}><option value="all">All sources</option>{(report?.sources || []).map((source) => <option key={source} value={source.toLowerCase()}>{source}</option>)}</select></label><label>Coordinator<select className="input select" value={filters.coordinatorId} onChange={(event) => updateFilter('coordinatorId', event.target.value)}><option value="all">All coordinators</option>{(report?.coordinators || []).map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name}</option>)}</select></label></div><div className="reports-scope-note">Cohort uses canonical intake date and excludes leads newer than the as-of snapshot. Outcomes are counted through {report?.filters?.asOf ? new Date(report.filters.asOf).toLocaleString() : 'the current snapshot'}; coordinator attribution is the current lead owner.</div><button className="btn" type="button" onClick={resetFilters}>Reset outcome filters</button></div>
    {report?.scope?.limitation && <div className="card reports-notice"><strong>Enrollment scope note</strong><span>{report.scope.limitation}</span></div>}
    <div className="grid-4 reports-metrics"><Metric label="Incoming leads" value={summary.incoming} detail="Selected cohort" /><Metric label="Successful contact" value={summary.contacted} detail={`${summary.contactRate}% contact rate`} /><Metric label="Enrolled" value={summary.enrolled} detail={`${summary.enrollmentRate}% enrollment rate`} /><Metric label="As of" value={new Date(report?.filters?.asOf || now).toLocaleDateString()} detail="Outcome snapshot" /></div>
    <div className="grid-2 reports-comparisons"><Comparison title="Incoming → successful contact" numerator={summary.contacted} denominator={summary.incoming} rate={summary.contactRate} color="var(--info)" /><Comparison title="Incoming → enrollment" numerator={summary.enrolled} denominator={summary.incoming} rate={summary.enrollmentRate} color="var(--success)" /></div>
    <section className="card reports-breakdown"><div className="reports-section-head"><div><div className="card-title">Performance breakdown</div><p className="page-subtitle">All counts reflect the filters above.</p></div><div className="segmented-control" role="group" aria-label="Breakdown grouping"><button className={filters.groupBy === 'source' ? 'active' : ''} aria-pressed={filters.groupBy === 'source'} onClick={() => updateFilter('groupBy', 'source')}>By source</button><button className={filters.groupBy === 'coordinator' ? 'active' : ''} aria-pressed={filters.groupBy === 'coordinator'} onClick={() => updateFilter('groupBy', 'coordinator')}>By coordinator</button></div></div><div className="table-container"><table className="data-table"><thead><tr><th>{filters.groupBy === 'source' ? 'Source' : 'Coordinator'}</th><th>Incoming</th><th>Contacted</th><th>Contact rate</th><th>Enrolled</th><th>Enrollment rate</th></tr></thead><tbody>{(report?.breakdown || []).map((group) => <tr key={group.key}><th scope="row">{group.label}</th><td>{group.incoming}</td><td>{group.contacted}</td><td>{group.contactRate}%</td><td>{group.enrolled}</td><td>{group.enrollmentRate}%</td></tr>)}{!report?.breakdown?.length && <tr><td colSpan="6"><PageState tone="empty" size="compact" title="No leads match these filters" copy="Try a wider date range, source, or coordinator." /></td></tr>}</tbody></table></div></section>
    <section className="card reports-evidence"><div className="reports-section-head"><div><div className="card-title">Lead evidence</div><p className="page-subtitle">The underlying cohort records behind the report.</p></div><span className="badge badge-neutral">{report?.pagination?.total || 0} leads</span></div><div className="table-container"><table className="data-table"><thead><tr><th>Lead</th><th>Lead date</th><th>Source</th><th>Current coordinator</th><th>Status</th><th>Contacted</th><th>Enrolled</th></tr></thead><tbody>{(report?.leads || []).map((lead) => <tr key={lead.id}><th scope="row"><a href={`/contacts/${encodeURIComponent(lead.contactId || '')}?leadId=${encodeURIComponent(lead.id)}`}>{lead.name}</a><small>{lead.email || 'No email'}</small></th><td>{lead.leadDate.slice(0, 10)}</td><td>{lead.source}</td><td>{lead.coordinator}</td><td>{lead.status}</td><td>{lead.contacted ? <span className="badge badge-success">Confirmed</span> : <span className="badge badge-neutral">Not evidenced</span>}</td><td>{lead.enrollmentSupported ? (lead.enrolled ? <span className="badge badge-success">Yes</span> : <span className="badge badge-neutral">No</span>) : <span className="badge badge-neutral">N/A</span>}</td></tr>)}{status === 'loading' && <tr><td colSpan="7">Loading filtered evidence…</td></tr>}{status !== 'loading' && !report?.leads?.length && <tr><td colSpan="7"><PageState tone="empty" size="compact" title="No lead evidence" copy="No cohort records match the selected scope." /></td></tr>}</tbody></table></div>{report?.pagination?.totalPages > 1 && <div className="reports-pagination"><button className="btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {report.pagination.totalPages}</span><button className="btn" disabled={page >= report.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button></div>}</section>
  </div>;
}

function Metric({ label, value, detail }) { return <div className="card report-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Comparison({ title, numerator, denominator, rate, color }) { const width = denominator ? Math.min(100, Math.max(0, (numerator / denominator) * 100)) : 0; return <div className="card report-comparison"><div className="reports-section-head"><div className="card-title">{title}</div><strong>{rate}%</strong></div><div className="report-bar"><span style={{ width: `${width}%`, background: color }} /></div><p>{numerator} of {denominator} incoming leads</p></div>; }
