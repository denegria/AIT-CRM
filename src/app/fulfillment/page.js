'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, Clock3, ExternalLink, PackageCheck, RefreshCw, ShieldCheck, Truck } from 'lucide-react';

import Modal from '@/components/Modal';
import PageState from '@/components/PageState';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { allFulfillmentLanesClear, fulfillmentStage } from '@/lib/fulfillment/presentation.js';
import { useCRM } from '@/lib/store';
import s from './FulfillmentPage.module.css';

const PAGE_SIZE = 25;
const LANES = Object.freeze([
  { key: 'digital', label: 'Digital access', title: 'Manual digital delivery', description: 'Send access outside the CRM, then confirm it was sent.', Icon: CheckCircle2 },
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
  const [selectedId, setSelectedId] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const detailHeadingRef = useRef(null);
  const queueRowRefs = useRef(new Map());
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
  const allClear = allFulfillmentLanesClear(queue?.counts);
  const selectedItem = useMemo(() => (
    queue?.items?.find((item) => item.id === selectedId) || queue?.items?.[0] || null
  ), [queue?.items, selectedId]);

  const selectLane = (nextLane) => {
    setLane(nextLane);
    setPage(1);
    setSelectedId('');
    setMobileDetailOpen(false);
    setConfirmation(null);
    requestAnimationFrame(() => document.getElementById(`fulfillment-lane-${nextLane}`)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    }));
  };

  const handleLaneKeyDown = (event, index) => {
    const keyMap = {
      ArrowLeft: (index - 1 + LANES.length) % LANES.length,
      ArrowRight: (index + 1) % LANES.length,
      Home: 0,
      End: LANES.length - 1,
    };
    const nextIndex = keyMap[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextLane = LANES[nextIndex];
    selectLane(nextLane.key);
    requestAnimationFrame(() => document.getElementById(`fulfillment-lane-${nextLane.key}`)?.focus());
  };

  const updateDraft = (id, field, value) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), [field]: value },
    }));
  };

  const selectItem = (item) => {
    setSelectedId(item.id);
    setMobileDetailOpen(true);
    if (window.matchMedia('(max-width: 680px)').matches) {
      requestAnimationFrame(() => detailHeadingRef.current?.focus());
    }
  };

  const returnToQueue = () => {
    const returnId = selectedItem?.id;
    setMobileDetailOpen(false);
    requestAnimationFrame(() => queueRowRefs.current.get(returnId)?.focus());
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
      return true;
    } catch (mutationError) {
      setError(mutationError.message || 'The fulfillment update failed.');
      return false;
    } finally {
      setSavingId('');
    }
  };

  const requestPrimaryAction = (item) => {
    const stage = fulfillmentStage(item, lane);
    if (stage.action === 'mark_shipped') {
      const draft = drafts[item.id] || {};
      if (!String(draft.carrier || '').trim() || !String(draft.trackingReference || '').trim()) {
        setError('Carrier and tracking reference are required before shipment can be recorded.');
        requestAnimationFrame(() => document.getElementById(`fulfillment-carrier-${item.id}`)?.focus());
        return;
      }
    }
    if (!stage.completion) {
      mutate(item, stage.action);
      return;
    }
    const consequence = {
      mark_digital_delivered: 'Only continue after access has been sent or granted outside the CRM. This records completion and removes the item from the active Digital access queue.',
      mark_picked_up: 'This records the book as picked up and removes it from the active Pickup queue.',
      mark_shipped: 'This records the carrier and tracking reference, then removes the item from the active Shipment queue.',
    }[stage.action];
    setConfirmation({ item, stage, consequence });
  };

  const confirmCompletion = async () => {
    const pending = confirmation;
    if (!pending) return;
    setConfirmation(null);
    const succeeded = await mutate(pending.item, pending.stage.action);
    if (succeeded) {
      setSelectedId('');
      setMobileDetailOpen(false);
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
          <h1>Book Fulfillment</h1>
          <p className={s.intro}>Every verified bundle that still needs manual digital delivery, pickup, or shipment—kept separate from the payment ledger.</p>
        </div>
      </header>

      {error && <div className={s.inlineError} role="alert">{error}</div>}

      <div className={s.workspaceToolbar}>
        <div className={s.lanesWrap}>
          <nav className={s.lanes} aria-label="Book fulfillment lanes" role="tablist">
            {LANES.map(({ key, label, Icon }, index) => (
              <button
                key={key}
                id={`fulfillment-lane-${key}`}
                type="button"
                role="tab"
                aria-selected={lane === key}
                aria-controls="fulfillment-workspace"
                tabIndex={lane === key ? 0 : -1}
                className={`${s.lane} ${lane === key ? s.laneActive : ''}`}
                onClick={() => selectLane(key)}
                onKeyDown={(event) => handleLaneKeyDown(event, index)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
                <b>{queue?.counts?.[key] || 0}</b>
              </button>
            ))}
          </nav>
          <span className={s.scrollCue} aria-hidden="true"><ChevronRight size={16} /></span>
        </div>
        <button className={`btn ${s.refreshButton}`} type="button" onClick={loadQueue} disabled={loading}>
          <RefreshCw size={16} className={loading ? s.spinning : ''} /> <span>Refresh</span>
        </button>
      </div>

      <section
        id="fulfillment-workspace"
        className={`${s.panel} ${allClear ? s.allClearPanel : ''}`}
        role="tabpanel"
        aria-labelledby={`fulfillment-lane-${lane}`}
        aria-busy={loading}
      >
        {allClear ? (
          <div className={s.allClear}>
            <span className={s.allClearIcon}><PackageCheck size={24} aria-hidden="true" /></span>
            <div>
              <h2>All book fulfillment is complete</h2>
              <p>No verified bundles are waiting for manual digital delivery, pickup, or shipment in {currentBusinessUnit?.name}.</p>
            </div>
          </div>
        ) : (
          <>
            <div className={s.panelHeader}>
              <div><h2>{selectedLane?.title || selectedLane?.label}</h2><p>{selectedLane?.description}</p></div>
              <span>{queue?.total || 0} item{queue?.total === 1 ? '' : 's'}</span>
            </div>

            {queue?.items?.length ? (
              <div className={`${s.workArea} ${mobileDetailOpen ? s.mobileDetailOpen : ''}`}>
                <div className={s.queuePane} aria-label={`${selectedLane?.label} fulfillment queue`}>
                  <div className={s.queueHeader}>
                    <span>Student</span><span>Status</span>
                  </div>
                  <div className={s.queueRows}>
                    {queue.items.map((item) => {
                      const stage = fulfillmentStage(item, lane);
                      const selected = selectedItem?.id === item.id;
                      return (
                        <button
                          key={item.id}
                          ref={(node) => {
                            if (node) queueRowRefs.current.set(item.id, node);
                            else queueRowRefs.current.delete(item.id);
                          }}
                          type="button"
                          className={`${s.queueRow} ${selected ? s.queueRowSelected : ''}`}
                          aria-pressed={selected}
                          aria-controls="fulfillment-selected-item"
                          onClick={() => selectItem(item)}
                        >
                          <span className={s.queueIdentity}>
                            <strong>{item.studentName}</strong>
                            <small>{ageLabel(item.paymentVerifiedAt || item.createdAt)}</small>
                          </span>
                          <span className={s.queueStage}>
                            <strong>{stage.label}</strong>
                          </span>
                          <span className={s.queueChevron}><ChevronRight size={15} aria-hidden="true" /></span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedItem && (() => {
                  const item = selectedItem;
                  const draft = drafts[item.id] || {};
                  const saving = savingId === item.id;
                  const address = formatAddress(item.shippingAddressSnapshot);
                  const stage = fulfillmentStage(item, lane);
                  const noteValue = draft.notes ?? item.notes ?? '';
                  return (
                    <article id="fulfillment-selected-item" className={s.detailPane} aria-labelledby="fulfillment-item-title">
                      <button className={s.mobileBack} type="button" onClick={returnToQueue}>
                        <ArrowLeft size={16} aria-hidden="true" /> Back to queue
                      </button>

                      <div className={s.detailHeading}>
                        <div>
                          <h3 id="fulfillment-item-title" ref={detailHeadingRef} tabIndex="-1">{item.studentName}</h3>
                          {lane === 'pickup' && <span className={s.stageBadge}>{stage.label}</span>}
                        </div>
                        <Link className={s.contactLink} href={`/contacts/${encodeURIComponent(item.studentContactId)}`}>
                          Contact Detail <ExternalLink size={14} aria-hidden="true" />
                        </Link>
                      </div>

                      <div className={s.detailMeta}>
                        <span><Clock3 size={14} aria-hidden="true" /> {ageLabel(item.paymentVerifiedAt || item.createdAt)}</span>
                        {item.readyAt && <span>Ready {formatDateTime(item.readyAt)}</span>}
                      </div>

                      {lane === 'digital' && (
                        <section className={s.manualDeliveryNote} aria-label="Manual delivery requirement">
                          <CheckCircle2 size={16} aria-hidden="true" />
                          <p><strong>Before confirming:</strong> Send or grant access through the approved external channel.</p>
                        </section>
                      )}

                      {lane === 'shipment' && (
                        <section className={s.detailSection} aria-labelledby="shipping-address-title">
                          <div className={s.addressHeading}>
                            <h4 id="shipping-address-title">Shipping address</h4>
                            <span className={s.addressPrivacy}><ShieldCheck size={14} aria-hidden="true" /> Visible only in Shipment</span>
                          </div>
                          <address className={s.address}>
                            {address.map((line) => <span key={line}>{line}</span>)}
                          </address>
                        </section>
                      )}

                      {access.canWriteCrm ? (
                        <div className={s.controls}>
                          {lane === 'shipment' && (
                            <section className={s.detailSection} aria-labelledby="tracking-title">
                              <h4 id="tracking-title">Shipment tracking</h4>
                              <div className={s.trackingFields}>
                                <label htmlFor={`fulfillment-carrier-${item.id}`}>Carrier<input id={`fulfillment-carrier-${item.id}`} value={draft.carrier || ''} onChange={(event) => updateDraft(item.id, 'carrier', event.target.value)} disabled={saving} /></label>
                                <label htmlFor={`fulfillment-tracking-${item.id}`}>Tracking reference<input id={`fulfillment-tracking-${item.id}`} value={draft.trackingReference || ''} onChange={(event) => updateDraft(item.id, 'trackingReference', event.target.value)} disabled={saving} /></label>
                              </div>
                            </section>
                          )}

                          <details className={s.noteDisclosure} open={Boolean(noteValue)}>
                            <summary>Operational note{item.notes ? ' · saved' : ''}</summary>
                            <label className={s.note} htmlFor={`fulfillment-note-${item.id}`}>
                              Context for the fulfillment team
                              <textarea id={`fulfillment-note-${item.id}`} value={noteValue} onChange={(event) => updateDraft(item.id, 'notes', event.target.value)} disabled={saving} rows={3} />
                            </label>
                            <button className="btn btn-sm" type="button" onClick={() => mutate(item, 'save_note')} disabled={saving}>Save note</button>
                          </details>

                          <div className={s.actions}>
                            <button className="btn btn-primary" type="button" onClick={() => requestPrimaryAction(item)} disabled={saving}>{stage.nextAction}</button>
                          </div>
                        </div>
                      ) : <p className={s.readOnly}>Read-only access</p>}
                    </article>
                  );
                })()}
              </div>
            ) : (
              <div className={s.empty}><PackageCheck size={28} /><h3>No pending {(selectedLane?.title || selectedLane?.label).toLowerCase()}</h3><p>This lane is clear while other fulfillment work remains.</p></div>
            )}

            {totalPages > 1 && (
              <div className={s.pagination}>
                <button className="btn" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
                <span>Page {page} of {totalPages}</span>
                <button className="btn" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
              </div>
            )}
          </>
        )}
      </section>

      <Modal
        open={Boolean(confirmation)}
        onClose={() => { if (!savingId) setConfirmation(null); }}
        title={confirmation?.stage?.nextAction || 'Complete fulfillment'}
        variant="dialog"
        panelClassName={s.confirmDialog}
        footer={(
          <>
            <button className="btn" type="button" onClick={() => setConfirmation(null)} disabled={Boolean(savingId)}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={confirmCompletion} disabled={Boolean(savingId)}>
              {savingId ? 'Saving…' : confirmation?.stage?.nextAction}
            </button>
          </>
        )}
      >
        <div className={s.confirmContent}>
          <span className={s.confirmIcon}><CheckCircle2 size={22} aria-hidden="true" /></span>
          <div>
            <strong>{confirmation?.item?.studentName}</strong>
            <p>{confirmation?.consequence}</p>
            <p className={s.confirmNote}>This completion is recorded in the fulfillment audit trail.</p>
          </div>
        </div>
      </Modal>
    </main>
  );
}
