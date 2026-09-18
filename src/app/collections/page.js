'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clipboard,
  CreditCard,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  UserRound,
} from 'lucide-react';

import PageState from '@/components/PageState';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { useCRM } from '@/lib/store';
import s from './CollectionsPage.module.css';

const PAGE_SIZE = 25;
const LANES = [
  { key: 'due', label: 'Due' },
  { key: 'partially_paid', label: 'Partial' },
  { key: 'overdue', label: 'Overdue' },
];
const ITEM_OPTIONS = [
  { code: 'registration_book_bundle', label: 'Registration + book', amount: '$95' },
  { code: 'registration_only', label: 'Registration only', amount: '$55' },
  { code: 'book_only', label: 'Book only', amount: '$55' },
];

function dollars(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function dateLabel(value) {
  if (!value) return 'No due date';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'No due date' : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function idempotency(prefix) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function initialCheckout() {
  return {
    contactId: '', name: '', email: '', phone: '', payerContactId: '', payerName: '', payerEmail: '', payerPhone: '',
    itemCode: 'registration_book_bundle', includeTuitionPrepayment: false,
    residenceCountryCode: 'US', billingCountryCode: 'US', learningModality: 'in_person',
    classSectionId: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '',
  };
}

export default function CollectionsPage() {
  const { loaded, access, currentBusinessUnitId, currentBusinessUnit } = useCRM();
  const isAitUsaScope = isAitUsaBusinessUnit(currentBusinessUnit?.name);
  const [lane, setLane] = useState('due');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkout, setCheckout] = useState(initialCheckout);
  const [manual, setManual] = useState({ amount: '', method: 'cash', reference: '', note: '' });
  const [hostedLink, setHostedLink] = useState(null);
  const [newPaymentRequest, setNewPaymentRequest] = useState(null);
  const [terminalConfirmId, setTerminalConfirmId] = useState('');
  const [terminalResult, setTerminalResult] = useState(null);
  const checkoutKey = useRef('');
  const manualKey = useRef('');
  const hostedKeys = useRef(new Map());
  const terminalKeys = useRef(new Map());

  const load = useCallback(async () => {
    if (!currentBusinessUnitId || !isAitUsaScope || ['all', 'unassigned'].includes(currentBusinessUnitId)) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        businessUnitId: currentBusinessUnitId,
        state: lane,
        search,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const response = await fetch(`/api/collections?${params}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Collections could not be loaded.');
      setPayload(body);
      setSelectedId((current) => body.queue.items.some((item) => item.id === current)
        ? current
        : body.queue.items[0]?.id || '');
    } catch (caught) {
      setError(caught.message || 'Collections could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentBusinessUnitId, isAitUsaScope, lane, page, search]);

  useEffect(() => {
    if (loaded) queueMicrotask(() => load());
  }, [load, loaded]);

  const selected = useMemo(
    () => payload?.queue?.items?.find((item) => item.id === selectedId) || null,
    [payload, selectedId],
  );
  const totalPages = Math.max(1, Math.ceil((payload?.queue?.total || 0) / PAGE_SIZE));

  const post = async (body) => {
    const response = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, businessUnitId: currentBusinessUnitId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The collections action failed.');
    return result.result;
  };

  const createCheckout = async (event) => {
    event.preventDefault();
    if (!checkoutKey.current) checkoutKey.current = idempotency('collections:checkout');
    setSaving('checkout'); setError(''); setNotice(''); setHostedLink(null);
    try {
      const selectedContact = payload?.setup?.contacts?.find((contact) => contact.id === checkout.contactId);
      const student = checkout.contactId
        ? { contactId: checkout.contactId }
        : { name: checkout.name, email: checkout.email, phone: checkout.phone };
      const payer = checkout.payerContactId === '__new__'
        ? { name: checkout.payerName, email: checkout.payerEmail, phone: checkout.payerPhone }
        : checkout.payerContactId && checkout.payerContactId !== checkout.contactId
          ? { contactId: checkout.payerContactId }
          : null;
      const shippingAddress = checkout.residenceCountryCode === 'US' && checkout.learningModality === 'online'
        ? {
          recipientName: selectedContact?.name || checkout.name,
          addressLine1: checkout.addressLine1,
          addressLine2: checkout.addressLine2,
          city: checkout.city,
          state: checkout.state,
          postalCode: checkout.postalCode,
          countryCode: 'US',
        }
        : undefined;
      const result = await post({
        action: 'create_checkout',
        registration: {
          idempotencyKey: checkoutKey.current,
          sourceReference: 'staff-collections-workspace',
          student,
          payer,
          itemCodes: [checkout.itemCode],
          includeTuitionPrepayment: checkout.includeTuitionPrepayment,
          residenceCountryCode: checkout.residenceCountryCode,
          billingCountryCode: checkout.billingCountryCode,
          learningModality: checkout.learningModality,
          shippingAddress,
          classSectionId: checkout.classSectionId || null,
        },
      });
      if (result.status === 'advisor_required') {
        setNotice('This registration needs advisor review before a payment request can be created.');
      } else {
        setNotice(`Payment request created for ${dollars(result.paymentRequest.requested_amount || result.paymentRequest.requestedAmount)}.`);
        setNewPaymentRequest(result.paymentRequest);
        setCheckout(initialCheckout());
        checkoutKey.current = '';
        setCheckoutOpen(false);
      }
      await load();
    } catch (caught) {
      setError(caught.message || 'Checkout could not be created.');
    } finally {
      setSaving('');
    }
  };

  const createHostedLink = async (paymentRequestId = selected?.paymentRequest?.id) => {
    if (!paymentRequestId) return;
    if (!hostedKeys.current.has(paymentRequestId)) {
      hostedKeys.current.set(paymentRequestId, idempotency('collections:hpp'));
    }
    setSaving('link'); setError(''); setNotice(''); setHostedLink(null);
    try {
      const result = await post({
        action: 'create_hosted_link',
        paymentRequestId,
        idempotencyKey: hostedKeys.current.get(paymentRequestId),
      });
      setHostedLink(result);
      setNewPaymentRequest(null);
      setNotice('Secure hosted checkout created. This URL is shown only in this response.');
      await load();
    } catch (caught) {
      setError(caught.message || 'Hosted checkout could not be created.');
    } finally {
      setSaving('');
    }
  };

  const runTerminalPayment = async (action, paymentRequestId = selected?.paymentRequest?.id) => {
    if (!paymentRequestId) return;
    const key = `${action}:${paymentRequestId}`;
    if (!terminalKeys.current.has(key)) {
      terminalKeys.current.set(key, idempotency(`collections:spin:${action}`));
    }
    setSaving(action === 'initiate_terminal_payment' ? 'terminal' : 'terminal-recovery');
    setError(''); setNotice(''); setHostedLink(null); setTerminalResult(null);
    try {
      const result = await post({
        action,
        paymentRequestId,
        idempotencyKey: terminalKeys.current.get(key),
      });
      setTerminalResult(result);
      setTerminalConfirmId('');
      if (result.outcome === 'completed') {
        setNotice('Terminal payment verified. The ledger and receipt were updated exactly once.');
      } else if (['failed', 'canceled', 'expired'].includes(result.outcome)) {
        setNotice(`Terminal payment ended as ${result.outcome}. No money was recorded.`);
      } else {
        setNotice('Terminal result is not final. No money was recorded; check terminal status before another attempt.');
      }
      await load();
    } catch (caught) {
      setError(caught.message || 'Terminal payment could not be completed safely.');
    } finally {
      setSaving('');
    }
  };

  const recordManual = async (event) => {
    event.preventDefault();
    if (!selected) return;
    if (!manualKey.current) manualKey.current = idempotency('collections:manual');
    setSaving('manual'); setError(''); setNotice('');
    try {
      const result = await post({
        action: 'record_manual_payment',
        payment: {
          ...manual,
          chargeId: selected.id,
          idempotencyKey: manualKey.current,
        },
      });
      setNotice(`${dollars(manual.amount)} recorded. Receipt ${result.receiptDocumentId ? 'created' : 'reused'}; ledger updated exactly once.`);
      setManual({ amount: '', method: 'cash', reference: '', note: '' });
      manualKey.current = '';
      await load();
    } catch (caught) {
      setError(caught.message || 'Manual payment could not be recorded.');
    } finally {
      setSaving('');
    }
  };

  if (!loaded || (loading && !payload)) {
    return <PageState tone="loading" title="Loading collections" copy="Reconciling charges, payments, receipts, and fulfillment…" />;
  }
  if (!access.canReadFinancials || !isAitUsaScope) {
    return <PageState tone="denied" title="AIT USA financial access required" copy="Select AIT USA and use an authorized financial role to open Collections." />;
  }
  if (error && !payload) {
    return <PageState tone="error" title="Collections unavailable" copy={error} actions={<button className="btn btn-primary" type="button" onClick={load}>Try again</button>} />;
  }

  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <p className={s.eyebrow}>AIT USA · money operations</p>
          <h1>Collections</h1>
          <p>Turn a registration into a payment request, collect securely, and follow every open balance without changing its original due date.</p>
        </div>
        <div className={s.headerActions}>
          <button className="btn" type="button" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? s.spin : ''} /> Refresh</button>
          {access.canWriteFinancials && <button className="btn btn-primary" type="button" onClick={() => setCheckoutOpen((open) => !open)}><Plus size={16} /> New checkout</button>}
        </div>
      </header>

      <div className={s.scope}><span>Division</span><strong>{currentBusinessUnit?.name}</strong><i>Card details never enter CRM</i></div>
      {error && <div className={s.alert} role="alert"><AlertTriangle size={18} /> {error}</div>}
      {notice && <div className={s.notice} role="status"><CheckCircle2 size={18} /> {notice}</div>}
      {hostedLink && (
        <div className={s.linkReveal}>
          <div><strong>Secure checkout ready</strong><span>Copy or open it now; CRM stores only the safe provider reference.</span></div>
          <button className="btn" type="button" onClick={() => navigator.clipboard.writeText(hostedLink.checkoutUrl)}><Clipboard size={15} /> Copy</button>
          <a className="btn btn-primary" href={hostedLink.checkoutUrl} target="_blank" rel="noreferrer">Open <ExternalLink size={15} /></a>
        </div>
      )}
      {newPaymentRequest && !hostedLink && (
        <div className={s.linkReveal}>
          <div><strong>Payment request ready</strong><span>Create its fixed-amount Dejavoo checkout when the payer is ready.</span></div>
          <button className="btn btn-primary" type="button" disabled={saving === 'link'} onClick={() => createHostedLink(newPaymentRequest.id)}><Link2 size={15} /> Create secure link</button>
        </div>
      )}
      {terminalResult && (
        <div className={s.terminalResult} role="status">
          <CreditCard size={18} />
          <div>
            <strong>Terminal result: {terminalResult.outcome?.replaceAll('_', ' ') || 'unknown'}</strong>
            <span>{terminalResult.recoveryGuidance || 'Provider verification is complete.'}</span>
          </div>
          <code>{terminalResult.correlationId}</code>
        </div>
      )}

      {checkoutOpen && (
        <form className={s.checkout} onSubmit={createCheckout}>
          <div className={s.checkoutHead}><div><span>Guided checkout</span><h2>Who is registering?</h2></div><button className="btn" type="button" onClick={() => setCheckoutOpen(false)}>Close</button></div>
          <div className={s.formGrid}>
            <label className={s.wide}>Existing contact<select value={checkout.contactId} onChange={(event) => setCheckout((current) => ({ ...current, contactId: event.target.value }))}><option value="">Create or match from identity</option>{payload?.setup?.contacts?.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.email || contact.phone || 'No contact detail'}</option>)}</select></label>
            {!checkout.contactId && <><label>Student name<input required value={checkout.name} onChange={(event) => setCheckout((current) => ({ ...current, name: event.target.value }))} /></label><label>Email<input type="email" value={checkout.email} onChange={(event) => setCheckout((current) => ({ ...current, email: event.target.value }))} /></label><label>Phone<input value={checkout.phone} onChange={(event) => setCheckout((current) => ({ ...current, phone: event.target.value }))} /></label></>}
            <label>Payer<select value={checkout.payerContactId} onChange={(event) => setCheckout((current) => ({ ...current, payerContactId: event.target.value }))}><option value="">Student is payer</option><option value="__new__">Create or match another payer</option>{payload?.setup?.contacts?.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
            {checkout.payerContactId === '__new__' && <><label>Payer name<input required value={checkout.payerName} onChange={(event) => setCheckout((current) => ({ ...current, payerName: event.target.value }))} /></label><label>Payer email<input type="email" value={checkout.payerEmail} onChange={(event) => setCheckout((current) => ({ ...current, payerEmail: event.target.value }))} /></label><label>Payer phone<input value={checkout.payerPhone} onChange={(event) => setCheckout((current) => ({ ...current, payerPhone: event.target.value }))} /></label></>}
            <label>Product<select value={checkout.itemCode} onChange={(event) => setCheckout((current) => ({ ...current, itemCode: event.target.value }))}>{ITEM_OPTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} · {item.amount}</option>)}</select></label>
            <label>Class section<select value={checkout.classSectionId} onChange={(event) => setCheckout((current) => ({ ...current, classSectionId: event.target.value }))}><option value="">Assign later</option>{payload?.setup?.sections?.map((section) => <option key={section.id} value={section.id}>{section.courseName} · {section.sectionKey}</option>)}</select></label>
            <label>Residence country<input maxLength={2} value={checkout.residenceCountryCode} onChange={(event) => setCheckout((current) => ({ ...current, residenceCountryCode: event.target.value.toUpperCase() }))} /></label>
            <label>Billing country<input maxLength={2} value={checkout.billingCountryCode} onChange={(event) => setCheckout((current) => ({ ...current, billingCountryCode: event.target.value.toUpperCase() }))} /></label>
            <label>Learning mode<select value={checkout.learningModality} onChange={(event) => setCheckout((current) => ({ ...current, learningModality: event.target.value }))}><option value="in_person">In person · pickup</option><option value="online">Online · ship in US</option></select></label>
            <label className={s.check}><input type="checkbox" checked={checkout.includeTuitionPrepayment} onChange={(event) => setCheckout((current) => ({ ...current, includeTuitionPrepayment: event.target.checked }))} />Add four-week tuition prepayment</label>
            {checkout.residenceCountryCode === 'US' && checkout.learningModality === 'online' && <><label className={s.wide}>Shipping address<input required value={checkout.addressLine1} onChange={(event) => setCheckout((current) => ({ ...current, addressLine1: event.target.value }))} /></label><label>City<input required value={checkout.city} onChange={(event) => setCheckout((current) => ({ ...current, city: event.target.value }))} /></label><label>State<input required value={checkout.state} onChange={(event) => setCheckout((current) => ({ ...current, state: event.target.value }))} /></label><label>ZIP<input required value={checkout.postalCode} onChange={(event) => setCheckout((current) => ({ ...current, postalCode: event.target.value }))} /></label></>}
          </div>
          <div className={s.checkoutFoot}><span>Pricing is calculated on the server from the approved catalog.</span><button className="btn btn-primary" disabled={saving === 'checkout'}>Create payment request</button></div>
        </form>
      )}

      <nav className={s.lanes} aria-label="Collections queues">
        {LANES.map((item) => <button key={item.key} type="button" className={lane === item.key ? s.activeLane : ''} onClick={() => { setLane(item.key); setPage(1); }}><span>{item.label}</span><b>{payload?.queue?.counts?.[item.key] || 0}</b></button>)}
        <label className={s.search}><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search student" /></label>
      </nav>

      <div className={s.workspace}>
        <section className={s.queue} aria-busy={loading}>
          <div className={s.panelHead}><div><span>{LANES.find((item) => item.key === lane)?.label}</span><h2>{payload?.queue?.total || 0} open balance{payload?.queue?.total === 1 ? '' : 's'}</h2></div></div>
          <div className={s.queueItems}>
            {payload?.queue?.items?.map((item) => <button type="button" key={item.id} className={`${s.queueItem} ${selectedId === item.id ? s.selected : ''}`} onClick={() => { setSelectedId(item.id); setHostedLink(null); }}>
              <span className={s.avatar}>{item.studentName?.slice(0, 1)?.toUpperCase() || '?'}</span>
              <span className={s.queueCopy}><strong>{item.studentName}</strong><small>{item.description}</small><em>{dateLabel(item.originalDueDate)}</em></span>
              <span className={s.money}><strong>{dollars(item.balance)}</strong><small>of {dollars(item.amount)}</small></span>
            </button>)}
            {!payload?.queue?.items?.length && <div className={s.empty}><CheckCircle2 size={30} /><h3>This queue is clear</h3><p>No {lane.replace('_', ' ')} balances match the current search.</p></div>}
          </div>
          {totalPages > 1 && <div className={s.pagination}><button className="btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>{page} / {totalPages}</span><button className="btn" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button></div>}
        </section>

        <section className={s.detail}>
          {selected ? <>
            <div className={s.studentHead}><div className={s.largeAvatar}><UserRound size={24} /></div><div><span>Student</span><h2>{selected.studentName}</h2><p>{[selected.studentEmail, selected.studentPhone].filter(Boolean).join(' · ') || 'No email or phone recorded'}</p></div><span className={`${s.badge} ${s[selected.state]}`}>{selected.state.replace('_', ' ')}</span></div>
            <div className={s.amountBand}><div><span>Balance</span><strong>{dollars(selected.balance)}</strong></div><div><span>Original charge</span><b>{dollars(selected.amount)}</b></div><div><span>Paid</span><b>{dollars(selected.allocated)}</b></div><div><span>Due date</span><b>{dateLabel(selected.originalDueDate)}</b></div></div>
            <div className={s.identityGrid}><div><span>Payer</span><strong>{selected.payerName || selected.studentName}</strong></div><div><span>Enrollment</span><strong>{selected.courseName || 'Placement pending'}</strong><small>{selected.sectionKey || 'Section not assigned'}</small></div><div><span>Charge</span><strong>{selected.description}</strong><small>{selected.chargeType.replaceAll('_', ' ')}</small></div><div><span>Fulfillment</span><strong>{selected.fulfillment?.deliveryMode || 'Not required'}</strong><small>{selected.fulfillment?.status || 'No book fulfillment'}</small></div></div>
            {selected.paymentRequest && <div className={s.requestCard}>
              <div><span>Payment request</span><strong>{selected.paymentRequest.merchantReference}</strong><small>{selected.paymentRequest.status} · {dollars(selected.paymentRequest.requestedAmount)}</small></div>
              {access.canWriteFinancials && !['completed', 'canceled', 'expired'].includes(selected.paymentRequest.status) && !selected.paymentRequest.metadata?.hostedPaymentAttempt && !selected.paymentRequest.metadata?.terminalPaymentAttempt && <button className="btn btn-primary" type="button" disabled={saving === 'link'} onClick={() => createHostedLink()}><Link2 size={15} /> Create secure link</button>}
              {access.canWriteFinancials && payload?.setup?.terminalCheckout?.ready && !['completed', 'canceled', 'expired'].includes(selected.paymentRequest.status) && !selected.paymentRequest.metadata?.hostedPaymentAttempt && !selected.paymentRequest.metadata?.terminalPaymentAttempt && <button className="btn" type="button" disabled={Boolean(saving)} onClick={() => setTerminalConfirmId(selected.paymentRequest.id)}><CreditCard size={15} /> Use terminal</button>}
              {access.canWriteFinancials && selected.paymentRequest.metadata?.terminalPaymentAttempt && !['completed', 'canceled', 'expired'].includes(selected.paymentRequest.status) && <button className="btn" type="button" disabled={Boolean(saving)} onClick={() => runTerminalPayment('recover_terminal_payment')}><RotateCcw size={15} /> Check terminal status</button>}
            </div>}
            {selected.paymentRequest && terminalConfirmId === selected.paymentRequest.id && <div className={s.terminalConfirm} role="region" aria-label="Confirm terminal payment">
              <div><strong>Charge {dollars(selected.paymentRequest.requestedAmount)} on the physical terminal?</strong><span>The payer must be present. A timeout is treated as unknown—not paid—and must be recovered before another attempt.</span></div>
              <button className="btn" type="button" disabled={Boolean(saving)} onClick={() => setTerminalConfirmId('')}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={Boolean(saving)} onClick={() => runTerminalPayment('initiate_terminal_payment')}><CreditCard size={15} /> Start terminal payment</button>
            </div>}
            {selected.latestTransaction && <div className={s.receipt}><Banknote size={18} /><div><strong>{selected.latestTransaction.provider === 'manual' ? 'Staff-recorded payment' : 'Provider payment'}</strong><span>{selected.latestTransaction.status} · {dollars(selected.latestTransaction.amount)}</span></div><small>{selected.latestTransaction.receiptDocumentId ? 'Receipt recorded' : 'No receipt yet'}</small></div>}
            {access.canWriteFinancials && selected.paymentRequest?.metadata?.terminalPaymentAttempt && !['completed', 'failed', 'canceled', 'expired'].includes(selected.paymentRequest.status)
              ? <div className={s.terminalLock}><AlertTriangle size={18} /><div><strong>Payment entry locked during terminal recovery</strong><span>Resolve the terminal status before recording cash, check, transfer, or another card attempt.</span></div></div>
              : access.canWriteFinancials && <form className={s.manual} onSubmit={recordManual}><div><span>Non-card payment</span><h3>Record money received</h3><p>Cash, check, transfer, money order, or Zelle. Card numbers never belong here.</p></div><div className={s.manualGrid}><label>Amount<input required inputMode="decimal" value={manual.amount} onChange={(event) => setManual((current) => ({ ...current, amount: event.target.value }))} placeholder={selected.balance} /></label><label>Method<select value={manual.method} onChange={(event) => setManual((current) => ({ ...current, method: event.target.value }))}><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank transfer</option><option value="money_order">Money order</option><option value="zelle">Zelle</option><option value="other">Other</option></select></label><label>Reference<input value={manual.reference} onChange={(event) => setManual((current) => ({ ...current, reference: event.target.value }))} /></label><label className={s.wide}>Audit note<input value={manual.note} onChange={(event) => setManual((current) => ({ ...current, note: event.target.value }))} /></label></div><button className="btn" disabled={saving === 'manual'}>Record payment</button></form>}
          </> : <div className={s.detailEmpty}><UserRound size={34} /><h2>Select an open balance</h2><p>The student, payer, enrollment, payment, receipt, and fulfillment trail will appear here.</p></div>}
        </section>
      </div>
    </main>
  );
}
