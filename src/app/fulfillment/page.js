'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, PackageCheck, RefreshCw, Truck, UserRoundCheck } from 'lucide-react';

import PageState from '@/components/PageState';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { useCRM } from '@/lib/store';
import s from './FulfillmentPage.module.css';

const PAGE_SIZE = 25;
const LANES = Object.freeze([
  { key: 'digital', label: 'Digital delivery', description: 'Send access, then record delivery.', Icon: CheckCircle2 },
  { key: 'pickup', label: 'Pickup', description: 'Prepare the book, then record pickup.', Icon: PackageCheck },
  { key: 'shipment', label: 'Shipment', description: 'Confirm the saved address and add tracking.', Icon: Truck },
]);

function formatDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function ageLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Age unavailable';
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return days === 0 ? 'Added today' : `${days} day${days === 1 ? '' : 's'} waiting`;
}

function formatAddress(address = {}) {
  return [
    address.recipientName,
    address.addressLine1,
    address.addressLine2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.countryCode,
  ].filter(Boolean);
}

export default function FulfillmentPage() {
  const {
    loaded,
    access,
    currentBusinessUnitId,
    currentBusinessUnit,
  } = useCRM();
  const [lane, setLane] = useState('digital');
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');
  const [drafts, setDrafts] = useState({});
  const isAitUsaScope = isAitUsaBusinessUnit(currentBusinessUnit?.name);

  const loadQueue = useCallback(async () => {
    if (!isAitUsaScope || !currentBusinessUnitId || ['all', 'unassigned'].includes(currentBusinessUnitId)) return;
    const params = new URLSearchParams({
      businessUnitId: currentBusinessUnitId,
      lane,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/fulfillment?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Book fulfillment could not be loaded.');
      setQueue(payload);
    } catch (loadError) {
      setError(loadError.message || 'Book fulfillment could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentBusinessUnitId, isAitUsaScope, lane, page]);

  useEffect(() => {
    if (loaded) queueMicrotask(() => loadQueue());
  }, [loadQueue, loaded]);

  const selectedLane = useMemo(() => LANES.find((entry) => entry.key === lane), [lane]);
  const totalPages = Math.max(1, Math.ceil((queue?.total || 0) / PAGE_SIZE));

  const updateDraft = (id, field, value) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), [field]: value },
    }));
  };

  const mutate = async (item, action) => {
    const draft = drafts[item.id] || {};
    setSavingId(item.id);
    setError('');
    try {
      const response = await fetch('/api/fulfillment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessUnitId: item.businessUnitId,
          fulfillmentId: item.id,
          expectedUpdatedAt: item.updatedAt,
          action,
          carrier: draft.carrier,
          trackingReference: draft.trackingReference,
          notes: draft.notes,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The fulfillment update failed.');
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await loadQueue();
    } catch (mutationError) {
      setError(mutationError.message || 'The fulfillment update failed.');
    } finally {
      setSavingId('');
    }
  };

  if (!loaded || (loading && !queue)) {
    return <PageState tone="loading" title="Loading book fulfillment" copy="Reconciling verified registrations and outstanding delivery work…" />;
  }
  if (!access.canReadCrm || !isAitUsaScope) {
    return <PageState tone="denied" title="AIT USA scope required" copy="Select the AIT USA division to view its book fulfillment worklist." />;
  }
  if (error && !queue) {
    return <PageState tone="error" title="Book fulfillment unavailable" copy={error} actions={<button className="btn btn-primary" type="button" onClick={loadQueue}>Try again</button>} />;
  }

  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <p className={s.eyebrow}>AIT USA operations</p>
          <h1>Book Fulfillment</h1>
          <p className={s.intro}>Every verified bundle that still needs digital access, pickup, or shipment—kept separate from the payment ledger.</p>
        </div>
        <button className="btn" type="button" onClick={loadQueue} disabled={loading}>
          <RefreshCw size={16} className={loading ? s.spinning : ''} /> Refresh
        </button>
      </header>

      <div className={s.scopeLine}>
        <span>Scope</span><strong>{currentBusinessUnit?.name}</strong>
        <span>Addresses appear only in Shipment</span>
      </div>

      {error && <div className={s.inlineError} role="alert">{error}</div>}

      <nav className={s.lanes} aria-label="Book fulfillment lanes">
        {LANES.map(({ key, label, description, Icon }) => (
          <button
            key={key}
            type="button"
            className={`${s.lane} ${lane === key ? s.laneActive : ''}`}
            aria-current={lane === key ? 'page' : undefined}
            onClick={() => { setLane(key); setPage(1); }}
          >
            <Icon size={18} />
            <span><strong>{label}</strong><small>{description}</small></span>
            <b>{queue?.counts?.[key] || 0}</b>
          </button>
        ))}
      </nav>

      <section className={s.panel} aria-busy={loading}>
        <div className={s.panelHeader}>
          <div><h2>{selectedLane?.label}</h2><p>{selectedLane?.description}</p></div>
          <span>{queue?.total || 0} item{queue?.total === 1 ? '' : 's'}</span>
        </div>

        {queue?.items?.length ? (
          <div className={s.items}>
            {queue.items.map((item) => {
              const draft = drafts[item.id] || {};
              const saving = savingId === item.id;
              const address = formatAddress(item.shippingAddressSnapshot);
              return (
                <article className={s.item} key={item.id}>
                  <div className={s.itemTop}>
                    <div>
                      <div className={s.titleRow}><h3>{item.studentName}</h3><span>{ageLabel(item.paymentVerifiedAt || item.createdAt)}</span></div>
                      <p className={s.progress}>{item.deliveryMode} · digital {item.digitalStatus.replace('_', ' ')} · physical {item.physicalStatus.replace('_', ' ')}</p>
                    </div>
                    <div className={s.owner}><UserRoundCheck size={15} /> {item.assignedUserName || 'Unassigned'}</div>
                  </div>

                  {lane === 'shipment' && (
                    <address className={s.address} aria-label="Shipping address">
                      {address.map((line) => <span key={line}>{line}</span>)}
                    </address>
                  )}

                  <div className={s.meta}>
                    <span><Clock3 size={14} /> Payment verified {formatDateTime(item.paymentVerifiedAt)}</span>
                    {item.readyAt && <span>Ready {formatDateTime(item.readyAt)}</span>}
                  </div>

                  {access.canWriteCrm ? (
                    <div className={s.controls}>
                      {lane === 'shipment' && (
                        <div className={s.trackingFields}>
                          <label>Carrier<input value={draft.carrier || ''} onChange={(event) => updateDraft(item.id, 'carrier', event.target.value)} disabled={saving} /></label>
                          <label>Tracking reference<input value={draft.trackingReference || ''} onChange={(event) => updateDraft(item.id, 'trackingReference', event.target.value)} disabled={saving} /></label>
                        </div>
                      )}
                      <label className={s.note}>Operational note<textarea value={draft.notes ?? item.notes ?? ''} onChange={(event) => updateDraft(item.id, 'notes', event.target.value)} disabled={saving} rows={2} /></label>
                      <div className={s.actions}>
                        {!item.assignedUserId && <button className="btn" type="button" onClick={() => mutate(item, 'claim')} disabled={saving}>Claim</button>}
                        <button className="btn" type="button" onClick={() => mutate(item, 'save_note')} disabled={saving}>Save note</button>
                        {lane === 'digital' && <button className="btn btn-primary" type="button" onClick={() => mutate(item, 'mark_digital_delivered')} disabled={saving}>Mark delivered</button>}
                        {lane === 'pickup' && item.physicalStatus === 'pending' && <button className="btn btn-primary" type="button" onClick={() => mutate(item, 'mark_ready')} disabled={saving}>Mark ready</button>}
                        {lane === 'pickup' && item.physicalStatus === 'ready' && <button className="btn btn-primary" type="button" onClick={() => mutate(item, 'mark_picked_up')} disabled={saving}>Mark picked up</button>}
                        {lane === 'shipment' && <button className="btn btn-primary" type="button" onClick={() => mutate(item, 'mark_shipped')} disabled={saving}>Mark shipped</button>}
                      </div>
                    </div>
                  ) : <p className={s.readOnly}>Read-only access</p>}
                </article>
              );
            })}
          </div>
        ) : (
          <div className={s.empty}><PackageCheck size={30} /><h3>No pending {selectedLane?.label.toLowerCase()}</h3><p>This lane is clear for the selected division.</p></div>
        )}

        {totalPages > 1 && (
          <div className={s.pagination}>
            <button className="btn" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button className="btn" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
          </div>
        )}
      </section>
    </main>
  );
}
