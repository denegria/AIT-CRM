'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  CreditCard,
  ExternalLink,
  HandCoins,
  Link2,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  WalletCards,
} from 'lucide-react';

import PageState from '@/components/PageState';
import { RegistrationPricingReview, TuitionPricingReview } from './FinancePricingReview.js';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { adjustStaffQuote } from '@/lib/registration/pricing.js';
import { nextTuitionAttempt } from '@/lib/collections/tuition-attempt.js';
import {
  calculateRegistrationQuote,
  REGISTRATION_CHANNELS,
  resolveRegionalPricing,
} from '@/lib/registration/catalog.js';
import { useCRM } from '@/lib/store';
import { classSectionDisplayLabel } from '@/lib/crm/class-section-display.js';
import s from './PaymentsWorkspace.module.css';

const PAGE_SIZE = 25;
const BALANCE_LANES = [
  { key: 'due', label: 'Due' },
  { key: 'partially_paid', label: 'Partial' },
];
const WORKSPACE_VIEWS = [
  { key: 'balances', label: 'Open balances' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'recent', label: 'Recent payments' },
  { key: 'reconciliation', label: 'Reconciliation' },
];
const ITEM_OPTIONS = [
  {
    code: 'registration_book_bundle',
    label: 'Registration + book',
    amount: '$95',
  },
  { code: 'registration_only', label: 'Registration only', amount: '$55' },
  { code: 'book_only', label: 'Book only', amount: '$55' },
];
const FLOW_STEPS = [
  'Student & payer',
  'What this covers',
  'Payment method',
  'Review & confirm',
];

function dollars(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function dateLabel(value) {
  if (!value) return 'No due date';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? 'No due date'
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
}

function dateTimeLabel(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
}

function idempotency(prefix) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function initialRegistration() {
  return {
    contactId: '',
    name: '',
    email: '',
    phone: '',
    payerContactId: '',
    payerName: '',
    payerEmail: '',
    payerPhone: '',
    itemCode: 'registration_book_bundle',
    customFinalAmounts: {},
    pricingReason: '',
    includeTuitionPrepayment: false,
    residenceCountryCode: 'US',
    billingCountryCode: 'US',
    learningModality: 'in_person',
    classSectionId: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
  };
}

function initialPaymentFlow() {
  return {
    mode: '',
    step: 0,
    studentContactId: '',
    payerContactId: '',
    intent: 'charge',
    chargeId: '',
    amount: '',
    note: '',
    method: 'hosted',
    manualMethod: 'cash',
    reference: '',
    manualNote: '',
    completed: false,
  };
}

function paymentAttemptState(item) {
  const hosted = item?.metadata?.hostedPaymentAttempt?.state;
  const terminal = item?.metadata?.terminalPaymentAttempt?.state;
  return terminal || hosted || item?.status || 'review';
}

export default function PaymentsWorkspace() {
  const { loaded, access, currentUser, currentBusinessUnitId, currentBusinessUnit } =
    useCRM();
  const isAitUsaScope = isAitUsaBusinessUnit(currentBusinessUnit?.name);
  const canOverridePricing = Boolean(currentUser?.roleKeys?.some((role) => ['admin', 'senior_coordinator'].includes(role)));
  const [view, setView] = useState('balances');
  const [lane, setLane] = useState('due');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hostedLink, setHostedLink] = useState(null);
  const [terminalResult, setTerminalResult] = useState(null);
  const [flow, setFlow] = useState(initialPaymentFlow);
  const [registration, setRegistration] = useState(initialRegistration);
  const [tuitionDraft, setTuitionDraft] = useState({ enrollmentId: '', periodStart: '', finalAmount: '', reason: '', adjustmentFinal: '', adjustmentReason: '', residenceCountryCode: '', billingCountryCode: '', evidence: '' });
  const [registrationSections, setRegistrationSections] = useState([]);
  const [registrationSectionsLoading, setRegistrationSectionsLoading] = useState(false);
  const [registrationSectionsError, setRegistrationSectionsError] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const requestKey = useRef('');
  const checkoutKey = useRef('');
  const methodKey = useRef('');
  const tuitionAttempt = useRef(null);
  const entrySource = useRef('payments-workspace');
  const stepHeadingRef = useRef(null);

  const activeLane = view === 'overdue' ? 'overdue' : lane;
  const load = useCallback(async () => {
    if (
      !currentBusinessUnitId ||
      !isAitUsaScope ||
      ['all', 'unassigned'].includes(currentBusinessUnitId)
    )
      return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        businessUnitId: currentBusinessUnitId,
        state: activeLane,
        search,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        contactSearch,
        paymentContactId: flow.studentContactId,
      });
      const response = await fetch(`/api/collections?${params}`, {
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || 'Payments could not be loaded.');
      setPayload(body);
      setSelectedId((current) =>
        body.queue.items.some((item) => item.id === current)
          ? current
          : body.queue.items[0]?.id || '',
      );
    } catch (caught) {
      setError(caught.message || 'Payments could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [
    activeLane,
    contactSearch,
    currentBusinessUnitId,
    flow.studentContactId,
    isAitUsaScope,
    page,
    search,
  ]);

  useEffect(() => {
    if (loaded) queueMicrotask(() => load());
  }, [load, loaded]);

  useEffect(() => {
    if (flow.mode !== 'registration' || !currentBusinessUnitId || !isAitUsaScope) return undefined;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setRegistrationSections([]);
      setRegistrationSectionsError('');
      setRegistrationSectionsLoading(true);
    });
    const params = new URLSearchParams({ businessUnitId: currentBusinessUnitId, view: 'sections' });
    fetch(`/api/collections?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Class list could not be refreshed.');
        const sections = Array.isArray(body.sections) ? body.sections : [];
        setRegistrationSections(sections);
        setRegistration((current) => sections.some((section) => section.id === current.classSectionId)
          ? current : { ...current, classSectionId: '' });
      })
      .catch((caught) => {
        if (caught.name !== 'AbortError') setRegistrationSectionsError(caught.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRegistrationSectionsLoading(false);
      });
    return () => controller.abort();
  }, [flow.mode, currentBusinessUnitId, isAitUsaScope]);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search || '');
    if (params.get('flow') !== 'take-payment') return;
    const contactId = params.get('contactId') || '';
    entrySource.current = 'contact-detail';
    queueMicrotask(() =>
      setFlow((current) => ({
        ...current,
        mode: 'payment',
        studentContactId: contactId,
        payerContactId: contactId,
      })),
    );
  }, []);

  useEffect(() => {
    if (flow.mode) queueMicrotask(() => stepHeadingRef.current?.focus());
  }, [flow.mode, flow.step]);

  const selected = useMemo(
    () => payload?.queue?.items?.find((item) => item.id === selectedId) || null,
    [payload, selectedId],
  );
  const paymentStudent = payload?.setup?.paymentStudent || null;
  const selectedTuitionEnrollment = paymentStudent?.tuitionEnrollments?.find((entry) => entry.id === tuitionDraft.enrollmentId);
  const needsLegacyPricingReview = Boolean(selectedTuitionEnrollment?.pricingReviewRequired);
  const reviewedLegacyRegional = needsLegacyPricingReview ? resolveRegionalPricing({ residenceCountryCode: tuitionDraft.residenceCountryCode, billingCountryCode: tuitionDraft.billingCountryCode }) : null;
  const matchingTuitionCharge = paymentStudent?.openCharges?.find((charge) => charge.chargeType === 'tuition_four_week'
    && charge.enrollmentId === tuitionDraft.enrollmentId && String(charge.servicePeriodStart).slice(0, 10) === tuitionDraft.periodStart);
  const totalPages = Math.max(
    1,
    Math.ceil((payload?.queue?.total || 0) / PAGE_SIZE),
  );
  const selectedCharge =
    paymentStudent?.openCharges?.find(
      (charge) => charge.id === flow.chargeId,
    ) || null;
  const selectedContact = payload?.setup?.contacts?.find(
    (contact) =>
      contact.id ===
      (flow.mode === 'registration'
        ? registration.contactId
        : flow.studentContactId),
  );
  const payerContactId =
    flow.mode === 'registration'
      ? registration.payerContactId
      : flow.payerContactId;
  const payerContact = payload?.setup?.contacts?.find(
    (contact) => contact.id === payerContactId,
  );
  const terminalReady = Boolean(payload?.setup?.terminalCheckout?.ready);
  const hostedReady = Boolean(payload?.setup?.hostedCheckout?.ready);
  const registrationQuote = useMemo(
    () =>
      calculateRegistrationQuote({
        channel: REGISTRATION_CHANNELS.STAFF,
        itemCodes: [registration.itemCode],
        includeTuitionPrepayment: registration.includeTuitionPrepayment,
        residenceCountryCode: registration.residenceCountryCode,
        billingCountryCode: registration.billingCountryCode,
      }),
    [
      registration.billingCountryCode,
      registration.includeTuitionPrepayment,
      registration.itemCode,
      registration.residenceCountryCode,
    ],
  );

  const hasRegistrationAdjustment = Object.values(registration.customFinalAmounts).some((amount) => String(amount).trim());
  const registrationPricing = (() => {
    if (!hasRegistrationAdjustment || !canOverridePricing || registrationQuote.status !== 'quoted') return { quote: registrationQuote, error: '' };
    try {
      return { quote: adjustStaffQuote(registrationQuote, {
        finalAmounts: Object.fromEntries(Object.entries(registration.customFinalAmounts).filter(([, amount]) => String(amount).trim())),
        reason: registration.pricingReason,
      }, { canOverridePricing: true, userId: currentUser?.id }), error: '' };
    } catch (caught) {
      return { quote: registrationQuote, error: caught.message };
    }
  })();
  const reviewedRegistrationQuote = registrationPricing.quote;

  const studentName =
    paymentStudent?.name ||
    selectedContact?.name ||
    registration.name ||
    'New student';
  const payerName =
    payerContactId === '__new__'
      ? registration.payerName || 'New payer'
      : payerContact?.name || studentName;

  const post = async (body) => {
    const response = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, businessUnitId: currentBusinessUnitId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(result.error || 'The payment action failed.');
    return result.result;
  };

  const openFlow = (mode, contactId = '') => {
    requestKey.current = '';
    checkoutKey.current = '';
    methodKey.current = '';
    entrySource.current = 'payments-workspace';
    setHostedLink(null);
    setTerminalResult(null);
    setError('');
    setNotice('');
    setRegistration(initialRegistration());
    tuitionAttempt.current = null;
    setTuitionDraft({ enrollmentId: '', periodStart: '', finalAmount: '', reason: '', adjustmentFinal: '', adjustmentReason: '', residenceCountryCode: '', billingCountryCode: '', evidence: '' });
    if (mode === 'registration') {
      setRegistrationSections([]);
      setRegistrationSectionsError('');
      setRegistrationSectionsLoading(true);
    }
    setFlow({
      ...initialPaymentFlow(),
      mode,
      studentContactId: contactId,
      payerContactId: contactId,
    });
  };

  const closeFlow = () => {
    setFlow(initialPaymentFlow());
    setRegistration(initialRegistration());
    setHostedLink(null);
    setTerminalResult(null);
    requestKey.current = '';
    checkoutKey.current = '';
    methodKey.current = '';
    tuitionAttempt.current = null;
  };

  const selectStudent = (contact) => {
    if (flow.mode === 'registration') {
      setRegistration((current) => ({
        ...current,
        contactId: contact.id,
        payerContactId: contact.id,
      }));
    } else {
      setFlow((current) => ({
        ...current,
        studentContactId: contact.id,
        payerContactId: contact.id,
        chargeId: '',
        amount: '',
      }));
    }
  };

  const validateStep = () => {
    if (flow.step === 0) {
      if (flow.mode === 'payment' && !flow.studentContactId)
        return 'Choose a student before continuing.';
      if (
        flow.mode === 'registration' &&
        !registration.contactId &&
        !registration.name.trim()
      )
        return 'Choose an existing student or enter a new student name.';
    }
    if (flow.step === 1 && flow.mode === 'payment') {
      if (flow.intent === 'charge' && !flow.chargeId)
        return 'Choose an existing balance or future installment.';
      if (!flow.amount || Number(flow.amount) <= 0)
        return 'Enter the amount to collect.';
      if (
        selectedCharge &&
        Number(flow.amount) > Number(selectedCharge.balance)
      )
        return 'Amount cannot exceed the selected balance.';
    }
    if (
      flow.step === 1 &&
      flow.mode === 'registration' &&
      registrationQuote.status !== 'quoted'
    ) {
      return 'This registration needs advisor review before payment can continue.';
    }
    if (flow.mode === 'registration' && registrationPricing.error) return registrationPricing.error;
    if (flow.step === 1 && flow.mode === 'registration' && (registrationSectionsLoading || registrationSectionsError)) {
      return registrationSectionsError || 'Wait for the current class list to load.';
    }
    if (flow.step === 2) {
      if (flow.method === 'hosted' && !hostedReady)
        return 'Secure payment links are temporarily unavailable. No payment request was created.';
      if (flow.method === 'terminal' && !terminalReady)
        return 'Physical terminal is not configured in this environment.';
      if (
        flow.method === 'manual' &&
        ['check', 'bank_transfer', 'money_order', 'zelle'].includes(
          flow.manualMethod,
        ) &&
        !flow.reference.trim()
      ) {
        return 'A reference is required for this non-card method.';
      }
    }
    return '';
  };

  const nextStep = () => {
    const message = validateStep();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setFlow((current) => ({ ...current, step: Math.min(current.step + 1, 3) }));
  };

  const executeMethod = async (paymentRequest) => {
    if (!methodKey.current)
      methodKey.current = idempotency(`payments:${flow.method}`);
    if (flow.method === 'hosted') {
      const result = await post({
        action: 'create_hosted_link',
        paymentRequestId: paymentRequest.id,
        idempotencyKey: methodKey.current,
      });
      setHostedLink(result);
      return 'Secure payment link created. It is shown once and CRM stores only the provider reference.';
    }
    if (flow.method === 'terminal') {
      const result = await post({
        action: 'initiate_terminal_payment',
        paymentRequestId: paymentRequest.id,
        idempotencyKey: methodKey.current,
      });
      setTerminalResult(result);
      return result.outcome === 'completed'
        ? 'Terminal payment verified. The ledger and receipt were updated exactly once.'
        : 'Terminal result is not final. No money was recorded; use Reconciliation before another attempt.';
    }
    const amount =
      flow.mode === 'registration'
        ? paymentRequest.requested_amount || paymentRequest.requestedAmount
        : flow.amount;
    const result = await post({
      action: 'record_manual_payment_request',
      paymentRequestId: paymentRequest.id,
      payment: {
        amount,
        method: flow.manualMethod,
        reference: flow.reference,
        note: flow.manualNote,
        idempotencyKey: methodKey.current,
      },
    });
    return `Payment recorded and receipt ${result.receiptDocumentId ? 'created' : 'reused'}.`;
  };

  const confirmFlow = async () => {
    const message = validateStep();
    if (message) {
      setError(message);
      return;
    }
    setSaving('confirm');
    setError('');
    setNotice('');
    try {
      let paymentRequest;
      if (flow.mode === 'payment') {
        if (!requestKey.current)
          requestKey.current = idempotency('payments:request');
        const result = await post({
          action: 'create_payment_request',
          paymentMethod: flow.method,
          sourceReference: entrySource.current,
          payment: {
            intent: flow.intent,
            studentContactId: flow.studentContactId,
            payerContactId: flow.payerContactId || flow.studentContactId,
            chargeId: flow.intent === 'charge' ? flow.chargeId : null,
            amount: flow.amount,
            note: flow.note,
            idempotencyKey: requestKey.current,
          },
        });
        paymentRequest = result.paymentRequest;
      } else {
        if (!checkoutKey.current)
          checkoutKey.current = idempotency('payments:registration');
        const student = registration.contactId
          ? { contactId: registration.contactId }
          : {
              name: registration.name,
              email: registration.email,
              phone: registration.phone,
            };
        const payer =
          registration.payerContactId === '__new__'
            ? {
                name: registration.payerName,
                email: registration.payerEmail,
                phone: registration.payerPhone,
              }
            : registration.payerContactId &&
                registration.payerContactId !== registration.contactId
              ? { contactId: registration.payerContactId }
              : null;
        const shippingAddress =
          registration.residenceCountryCode === 'US' &&
          registration.learningModality === 'online'
            ? {
                recipientName: selectedContact?.name || registration.name,
                addressLine1: registration.addressLine1,
                addressLine2: registration.addressLine2,
                city: registration.city,
                state: registration.state,
                postalCode: registration.postalCode,
                countryCode: 'US',
              }
            : undefined;
        const result = await post({
          action: 'create_checkout',
          paymentMethod: flow.method,
          registration: {
            idempotencyKey: checkoutKey.current,
            sourceReference: 'staff-payments-workspace',
            student,
            payer,
            itemCodes: [registration.itemCode],
            includeTuitionPrepayment: registration.includeTuitionPrepayment,
            ...(hasRegistrationAdjustment ? { pricingAdjustment: { finalAmounts: Object.fromEntries(Object.entries(registration.customFinalAmounts).filter(([, amount]) => String(amount).trim())), reason: registration.pricingReason } } : {}),
            residenceCountryCode: registration.residenceCountryCode,
            billingCountryCode: registration.billingCountryCode,
            learningModality: registration.learningModality,
            shippingAddress,
            classSectionId: registration.classSectionId || null,
          },
        });
        if (result.status === 'advisor_required') {
          setNotice(
            'This registration needs advisor review before a payment request can be created.',
          );
          return;
        }
        paymentRequest = result.paymentRequest;
      }
      const outcome = await executeMethod(paymentRequest);
      setNotice(outcome);
      setFlow((current) => ({ ...current, completed: true }));
      await load();
    } catch (caught) {
      setError(
        caught.message ||
          'Payment could not be completed safely. The request remains available for review.',
      );
    } finally {
      setSaving('');
    }
  };

  const createTuitionCharge = async () => {
    setSaving('tuition'); setError('');
    try {
      const charge = {
        studentContactId: flow.studentContactId,
        enrollmentId: tuitionDraft.enrollmentId,
        servicePeriodStart: tuitionDraft.periodStart,
        ...(canOverridePricing && tuitionDraft.finalAmount.trim() ? { finalAmount: tuitionDraft.finalAmount, reason: tuitionDraft.reason } : {}),
        ...(needsLegacyPricingReview ? { legacyPricingReview: {
          residenceCountryCode: tuitionDraft.residenceCountryCode,
          billingCountryCode: tuitionDraft.billingCountryCode,
          evidence: tuitionDraft.evidence,
        } } : {}),
      };
      tuitionAttempt.current = nextTuitionAttempt(tuitionAttempt.current, currentBusinessUnitId, charge, () => idempotency('tuition:charge'));
      const result = await post({ action: 'create_tuition_charge', charge: { ...charge, idempotencyKey: tuitionAttempt.current.key } });
      tuitionAttempt.current = null;
      setFlow((current) => ({ ...current, intent: 'charge', chargeId: result.charge.id, amount: result.charge.amount }));
      setNotice(result.duplicate ? 'Existing four-week tuition charge recovered. Review its persisted amount before payment.' : 'Four-week tuition charge created. Review its persisted amount before payment.');
      await load();
    } catch (caught) {
      await load();
      setError(`${caught.message || 'Tuition charge could not be created.'} Review any charge now shown for this period before retrying unchanged.`);
    }
    finally { setSaving(''); }
  };

  const adjustTuitionCharge = async () => {
    setSaving('tuition-adjustment'); setError('');
    try {
      const result = await post({ action: 'adjust_tuition_charge', charge: {
        chargeId: flow.chargeId, finalAmount: tuitionDraft.adjustmentFinal,
        reason: tuitionDraft.adjustmentReason, idempotencyKey: idempotency('tuition:adjust'),
      } });
      setFlow((current) => ({ ...current, amount: result.charge.amount }));
      setNotice('Unpaid tuition charge adjusted. Review the final amount before payment.');
      await load();
    } catch (caught) { setError(caught.message || 'Tuition charge could not be adjusted.'); }
    finally { setSaving(''); }
  };

  const recoverTerminal = async (paymentRequestId) => {
    setSaving('recovery');
    setError('');
    try {
      const result = await post({
        action: 'recover_terminal_payment',
        paymentRequestId,
        idempotencyKey: idempotency('payments:terminal-recovery'),
      });
      setTerminalResult(result);
      setNotice(
        result.outcome === 'completed'
          ? 'Terminal payment verified and reconciled.'
          : 'Terminal result is still not final. No money was recorded.',
      );
      await load();
    } catch (caught) {
      setError(
        caught.message || 'Terminal status could not be recovered safely.',
      );
    } finally {
      setSaving('');
    }
  };

  if (!loaded || (loading && !payload)) {
    return (
      <PageState
        tone="loading"
        title="Loading payments"
        copy="Reconciling balances, payment requests, receipts, and provider state…"
      />
    );
  }
  if (!access.canReadFinancials || !isAitUsaScope) {
    return (
      <PageState
        tone="denied"
        title="AIT USA financial access required"
        copy="Select AIT USA and use an authorized financial role to open Payments."
      />
    );
  }
  if (error && !payload) {
    return (
      <PageState
        tone="error"
        title="Payments unavailable"
        copy={error}
        actions={
          <button className="btn btn-primary" type="button" onClick={load}>
            Try again
          </button>
        }
      />
    );
  }

  const paymentAmount =
    flow.mode === 'registration'
      ? registrationQuote.status === 'quoted'
        ? dollars(reviewedRegistrationQuote.total)
        : 'Advisor review required'
      : dollars(flow.amount);

  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <h1>Payments</h1>
          {!flow.mode && (
            <p>
              Take a payment, start a registration, and resolve open balances
              through one verified ledger and receipt trail.
            </p>
          )}
        </div>
      </header>

      {!flow.mode && (
        <section className={s.primaryActions} aria-label="Payment actions">
          <button
            type="button"
            className={`${s.actionCard} ${s.primaryActionCard}`}
            onClick={() => openFlow('payment')}
            disabled={!access.canWriteFinancials}
          >
            <span className={s.actionIcon}>
              <HandCoins size={22} />
            </span>
            <span>
              <strong>Take payment</strong>
              <small>
                Existing balance, future installment, or account credit
              </small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button
            type="button"
            className={s.actionCard}
            onClick={() => openFlow('registration')}
            disabled={!access.canWriteFinancials}
          >
            <span className={s.actionIcon}>
              <ReceiptText size={22} />
            </span>
            <span>
              <strong>New registration</strong>
              <small>
                Student, product, class placement, and initial payment
              </small>
            </span>
            <ArrowRight size={18} />
          </button>
          <div className={s.securityCard}>
            <ShieldCheck size={19} />
            <span>
              <strong>Card data stays with the provider</strong>
              <small>
                CRM stores verified references, allocations, and receipts.
              </small>
            </span>
          </div>
        </section>
      )}

      {error && (
        <div className={s.alert} role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      )}
      {notice && (
        <div className={s.notice} role="status">
          <CheckCircle2 size={18} /> {notice}
        </div>
      )}

      {flow.mode ? (
        <section
          className={s.flowShell}
          aria-label={
            flow.mode === 'payment' ? 'Take payment' : 'New registration'
          }
        >
          <div className={s.flowTopbar}>
            <strong>
              {flow.mode === 'payment' ? 'Take payment' : 'New registration'}
            </strong>
            <button className="btn" type="button" onClick={closeFlow}>
              Close
            </button>
          </div>
          <ol className={s.stepper} aria-label="Payment progress">
            {FLOW_STEPS.map((label, index) => (
              <li
                key={label}
                className={
                  index === flow.step
                    ? s.currentStep
                    : index < flow.step
                      ? s.completeStep
                      : ''
                }
                aria-current={index === flow.step ? 'step' : undefined}
              >
                <span>
                  {index < flow.step ? <Check size={13} /> : index + 1}
                </span>
                <small>{label}</small>
              </li>
            ))}
          </ol>

          <div className={s.flowBody}>
            <h2 ref={stepHeadingRef} tabIndex={-1}>
              {FLOW_STEPS[flow.step]}
            </h2>
            {flow.step === 0 && (
              <div className={s.stepContent}>
                <p>
                  Find the student first. The payer may be the student or
                  another contact in the same division.
                </p>
                <form
                  className={s.contactSearch}
                  onSubmit={(event) => {
                    event.preventDefault();
                    setContactSearch(contactQuery);
                  }}
                >
                  <label>
                    <span>Search students</span>
                    <div>
                      <Search size={16} />
                      <input
                        value={contactQuery}
                        onChange={(event) =>
                          setContactQuery(event.target.value)
                        }
                        placeholder="Name, email, or phone"
                      />
                    </div>
                  </label>
                  <button className="btn" type="submit">
                    Search
                  </button>
                </form>
                <div
                  className={s.contactResults}
                  role="listbox"
                  aria-label="Student search results"
                >
                  {payload?.setup?.contacts?.map((contact) => {
                    const selectedForMode =
                      flow.mode === 'registration'
                        ? registration.contactId === contact.id
                        : flow.studentContactId === contact.id;
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        role="option"
                        aria-selected={selectedForMode}
                        className={selectedForMode ? s.selectedContact : ''}
                        onClick={() => selectStudent(contact)}
                      >
                        <span className={s.avatar}>
                          {contact.name?.slice(0, 1)?.toUpperCase() || '?'}
                        </span>
                        <span>
                          <strong>{contact.name}</strong>
                          <small>
                            {contact.email ||
                              contact.phone ||
                              'No contact detail'}
                          </small>
                        </span>
                        {selectedForMode && <CheckCircle2 size={18} />}
                      </button>
                    );
                  })}
                </div>
                {flow.mode === 'registration' && !registration.contactId && (
                  <fieldset className={s.fieldset}>
                    <legend>Or create / identity-match a student</legend>
                    <div className={s.formGrid}>
                      <label>
                        Student name
                        <input
                          value={registration.name}
                          onChange={(event) =>
                            setRegistration((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Email
                        <input
                          type="email"
                          value={registration.email}
                          onChange={(event) =>
                            setRegistration((current) => ({
                              ...current,
                              email: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Phone
                        <input
                          value={registration.phone}
                          onChange={(event) =>
                            setRegistration((current) => ({
                              ...current,
                              phone: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </fieldset>
                )}
                <label className={s.selectField}>
                  Payer
                  <select
                    value={
                      flow.mode === 'registration'
                        ? registration.payerContactId
                        : flow.payerContactId
                    }
                    onChange={(event) =>
                      flow.mode === 'registration'
                        ? setRegistration((current) => ({
                            ...current,
                            payerContactId: event.target.value,
                          }))
                        : setFlow((current) => ({
                            ...current,
                            payerContactId: event.target.value,
                          }))
                    }
                  >
                    <option value="">Student is payer</option>
                    {flow.mode === 'registration' && (
                      <option value="__new__">
                        Create or match another payer
                      </option>
                    )}
                    {payload?.setup?.contacts?.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}
                      </option>
                    ))}
                  </select>
                </label>
                {flow.mode === 'registration' &&
                  registration.payerContactId === '__new__' && (
                    <div className={s.formGrid}>
                      <label>
                        Payer name
                        <input
                          value={registration.payerName}
                          onChange={(event) =>
                            setRegistration((current) => ({
                              ...current,
                              payerName: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Payer email
                        <input
                          type="email"
                          value={registration.payerEmail}
                          onChange={(event) =>
                            setRegistration((current) => ({
                              ...current,
                              payerEmail: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Payer phone
                        <input
                          value={registration.payerPhone}
                          onChange={(event) =>
                            setRegistration((current) => ({
                              ...current,
                              payerPhone: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
              </div>
            )}

            {flow.step === 1 && flow.mode === 'payment' && (
              <div className={s.stepContent}>
                <div className={s.studentSummary}>
                  <UserRound size={19} />
                  <span>
                    <strong>
                      {paymentStudent?.name ||
                        selectedContact?.name ||
                        'Selected student'}
                    </strong>
                    <small>
                      Available account credit:{' '}
                      {dollars(paymentStudent?.accountCredit)}
                    </small>
                  </span>
                </div>
                {paymentStudent?.tuitionEnrollments?.length > 0 && (
                  <div className={s.pricingEditor}>
                    <strong>Create four-week tuition charge</strong>
                    <small>Create a real charge for an active enrollment and 28-day period before collecting payment. Legacy enrollments require a privileged country-evidence review.</small>
                    <label>Enrollment
                      <select value={tuitionDraft.enrollmentId} onChange={(event) => setTuitionDraft((current) => ({ ...current, enrollmentId: event.target.value }))}>
                        <option value="">Select enrollment</option>
                        {paymentStudent.tuitionEnrollments.map((enrollment) => <option key={enrollment.id} value={enrollment.id} disabled={!enrollment.standardAmount && !(canOverridePricing && enrollment.pricingReviewRequired)}>
                          {enrollment.courseName} · {enrollment.standardAmount ? `standard ${dollars(enrollment.standardAmount)}` : enrollment.pricingReviewRequired ? 'country evidence review required' : 'pricing evidence invalid'}
                        </option>)}
                      </select>
                    </label>
                    {needsLegacyPricingReview && canOverridePricing && <>
                      <small>Review the registration record or another authoritative source. Enter both countries; the catalog determines the rate. This attestation is stored with the enrollment and charge audit.</small>
                      <label>Residence country (2-letter code)
                        <input maxLength={2} value={tuitionDraft.residenceCountryCode} onChange={(event) => setTuitionDraft((current) => ({ ...current, residenceCountryCode: event.target.value.toUpperCase() }))} />
                      </label>
                      <label>Billing country (2-letter code)
                        <input maxLength={2} value={tuitionDraft.billingCountryCode} onChange={(event) => setTuitionDraft((current) => ({ ...current, billingCountryCode: event.target.value.toUpperCase() }))} />
                      </label>
                      <label>Evidence source and reference
                        <textarea maxLength={300} value={tuitionDraft.evidence} onChange={(event) => setTuitionDraft((current) => ({ ...current, evidence: event.target.value }))} />
                      </label>
                      <small>{/^[A-Z]{2}$/.test(tuitionDraft.residenceCountryCode) && /^[A-Z]{2}$/.test(tuitionDraft.billingCountryCode) && reviewedLegacyRegional?.status === 'eligible' ? `Catalog standard: ${dollars(reviewedLegacyRegional.tuitionRateCents / 100)}` : 'Enter two supported countries in the same pricing region to see the catalog standard.'}</small>
                    </>}
                    <label>Service period start
                      <input type="date" value={tuitionDraft.periodStart} onChange={(event) => setTuitionDraft((current) => ({ ...current, periodStart: event.target.value }))} />
                    </label>
                    {canOverridePricing && <>
                      <label>Custom final amount (optional)
                        <input inputMode="decimal" placeholder="Use standard rate" value={tuitionDraft.finalAmount} onChange={(event) => setTuitionDraft((current) => ({ ...current, finalAmount: event.target.value }))} />
                      </label>
                      {tuitionDraft.finalAmount && <label>Adjustment reason
                        <textarea maxLength={500} value={tuitionDraft.reason} onChange={(event) => setTuitionDraft((current) => ({ ...current, reason: event.target.value }))} />
                      </label>}
                    </>}
                    {matchingTuitionCharge && <small>This period already has an open charge for {dollars(matchingTuitionCharge.amount)}. Select it below and review the persisted amount before payment.</small>}
                    <button type="button" className="btn" disabled={Boolean(saving) || !tuitionDraft.enrollmentId || !tuitionDraft.periodStart || Boolean(matchingTuitionCharge) || (needsLegacyPricingReview && (!/^[A-Z]{2}$/.test(tuitionDraft.residenceCountryCode) || !/^[A-Z]{2}$/.test(tuitionDraft.billingCountryCode) || reviewedLegacyRegional?.status !== 'eligible' || tuitionDraft.evidence.trim().length < 10))} onClick={createTuitionCharge}>Create charge</button>
                  </div>
                )}
                <fieldset className={s.choiceGroup}>
                  <legend>What does this payment cover?</legend>
                  {paymentStudent?.openCharges?.map((charge) => {
                    const future =
                      charge.originalDueDate &&
                      String(charge.originalDueDate).slice(0, 10) >
                        new Date().toISOString().slice(0, 10);
                    return (
                      <button
                        type="button"
                        key={charge.id}
                        className={
                          flow.intent === 'charge' &&
                          flow.chargeId === charge.id
                            ? s.selectedChoice
                            : ''
                        }
                        onClick={() =>
                          setFlow((current) => ({
                            ...current,
                            intent: 'charge',
                            chargeId: charge.id,
                            amount: charge.balance,
                          }))
                        }
                      >
                        <span>
                          <strong>
                            {future ? 'Future installment' : charge.description}
                          </strong>
                          <small>
                            {future
                              ? `${charge.description} · due ${dateLabel(charge.originalDueDate)}`
                              : `Due ${dateLabel(charge.originalDueDate)}`}
                          </small>
                        </span>
                        <b>{dollars(charge.balance)}</b>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={
                      flow.intent === 'account_credit' ? s.selectedChoice : ''
                    }
                    onClick={() =>
                      setFlow((current) => ({
                        ...current,
                        intent: 'account_credit',
                        chargeId: '',
                        amount: '',
                      }))
                    }
                  >
                    <span>
                      <strong>Account credit</strong>
                      <small>
                        Hold unapplied credit for a later installment or
                        approved charge
                      </small>
                    </span>
                    <WalletCards size={19} />
                  </button>
                </fieldset>
                {canOverridePricing && selectedCharge?.chargeType === 'tuition_four_week' && selectedCharge.allocated === '0.00' && !selectedCharge.paymentRequest && (
                  <div className={s.pricingEditor}>
                    <strong>Adjust unpaid tuition charge</strong>
                    <small>Standard {dollars(selectedCharge.pricing?.standardAmount || selectedCharge.amount)} · Current {dollars(selectedCharge.amount)}. Existing allocations or payment requests block adjustment.</small>
                    <label>New positive final amount
                      <input inputMode="decimal" value={tuitionDraft.adjustmentFinal} onChange={(event) => setTuitionDraft((current) => ({ ...current, adjustmentFinal: event.target.value }))} />
                    </label>
                    <label>Adjustment reason
                      <textarea maxLength={500} value={tuitionDraft.adjustmentReason} onChange={(event) => setTuitionDraft((current) => ({ ...current, adjustmentReason: event.target.value }))} />
                    </label>
                    <button type="button" className="btn" disabled={Boolean(saving) || !tuitionDraft.adjustmentFinal || !tuitionDraft.adjustmentReason.trim()} onClick={adjustTuitionCharge}>Apply adjustment</button>
                  </div>
                )}
                {!paymentStudent?.openCharges?.length && (
                  <div className={s.inlineInfo}>
                    No open or future-dated charge exists. Use account credit
                    for an intentional prepayment.
                  </div>
                )}
                <div className={s.formGrid}>
                  <label>
                    Amount
                    <input
                      required
                      inputMode="decimal"
                      value={flow.amount}
                      onChange={(event) =>
                        setFlow((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                    />
                  </label>
                  <label className={s.wide}>
                    Payment context (optional)
                    <input
                      value={flow.note}
                      onChange={(event) =>
                        setFlow((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Example: prepaying October tuition"
                    />
                  </label>
                </div>
              </div>
            )}

            {flow.step === 1 && flow.mode === 'registration' && (
              <div className={s.stepContent}>
                <p>
                  Choose the approved registration product and fulfillment
                  context. Pricing is calculated on the server.
                </p>
                <div className={s.formGrid}>
                  <label>
                    Product
                    <select
                      value={registration.itemCode}
                      onChange={(event) =>
                        setRegistration((current) => ({
                          ...current,
                          itemCode: event.target.value,
                          customFinalAmounts: {},
                        }))
                      }
                    >
                      {ITEM_OPTIONS.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.label} · {item.amount}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Class section
                    <select
                      value={registration.classSectionId}
                      disabled={registrationSectionsLoading || Boolean(registrationSectionsError)}
                      onChange={(event) =>
                        setRegistration((current) => ({
                          ...current,
                          classSectionId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Assign later</option>
                      {registrationSections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {classSectionDisplayLabel(section)}
                        </option>
                      ))}
                    </select>
                    {registrationSectionsLoading && <small>Loading current classes…</small>}
                    {registrationSectionsError && <small role="alert">{registrationSectionsError}</small>}
                  </label>
                  <label>
                    Residence country
                    <input
                      maxLength={2}
                      value={registration.residenceCountryCode}
                      onChange={(event) =>
                        setRegistration((current) => ({
                          ...current,
                          residenceCountryCode:
                            event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Billing country
                    <input
                      maxLength={2}
                      value={registration.billingCountryCode}
                      onChange={(event) =>
                        setRegistration((current) => ({
                          ...current,
                          billingCountryCode: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Learning mode
                    <select
                      value={registration.learningModality}
                      onChange={(event) =>
                        setRegistration((current) => ({
                          ...current,
                          learningModality: event.target.value,
                        }))
                      }
                    >
                      <option value="in_person">In person · pickup</option>
                      <option value="online">
                        Online · digital + ship in US
                      </option>
                    </select>
                  </label>
                  <label className={s.check}>
                    <input
                      type="checkbox"
                      checked={registration.includeTuitionPrepayment}
                      onChange={(event) =>
                        setRegistration((current) => ({
                          ...current,
                          includeTuitionPrepayment: event.target.checked,
                          customFinalAmounts: {},
                        }))
                      }
                    />
                    Add four-week tuition prepayment
                  </label>
                  {canOverridePricing && registrationQuote.status === 'quoted' && (
                    <div className={s.pricingEditor}>
                      <strong>Custom final charge or credit</strong>
                      <small>Standard catalog rates are authoritative. Enter a positive final amount below a standard line; a reason is required.</small>
                      {registrationQuote.lines.map((line) => (
                        <label key={line.code}>
                          {line.label} · standard {dollars(line.amount)}
                          <input inputMode="decimal" placeholder={line.amount} value={registration.customFinalAmounts[line.code] || ''}
                            onChange={(event) => setRegistration((current) => ({ ...current,
                              customFinalAmounts: { ...current.customFinalAmounts, [line.code]: event.target.value },
                            }))} />
                        </label>
                      ))}
                      {hasRegistrationAdjustment && <label>Adjustment reason
                        <textarea maxLength={500} value={registration.pricingReason}
                          onChange={(event) => setRegistration((current) => ({ ...current, pricingReason: event.target.value }))} />
                      </label>}
                      {registrationPricing.error && <small role="alert">{registrationPricing.error}</small>}
                    </div>
                  )}
                  {registration.residenceCountryCode === 'US' &&
                    registration.learningModality === 'online' && (
                      <>
                        <label className={s.wide}>
                          Shipping address
                          <input
                            value={registration.addressLine1}
                            onChange={(event) =>
                              setRegistration((current) => ({
                                ...current,
                                addressLine1: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          City
                          <input
                            value={registration.city}
                            onChange={(event) =>
                              setRegistration((current) => ({
                                ...current,
                                city: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          State
                          <input
                            value={registration.state}
                            onChange={(event) =>
                              setRegistration((current) => ({
                                ...current,
                                state: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          ZIP
                          <input
                            value={registration.postalCode}
                            onChange={(event) =>
                              setRegistration((current) => ({
                                ...current,
                                postalCode: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </>
                    )}
                </div>
              </div>
            )}

            {flow.step === 2 && (
              <div className={s.stepContent}>
                <p>
                  Choose how the payer will complete this reviewed amount.
                  Payment intent stays unchanged.
                </p>
                <div className={s.methodGrid}>
                  <button
                    type="button"
                    className={flow.method === 'hosted' ? s.selectedMethod : ''}
                    onClick={() =>
                      setFlow((current) => ({ ...current, method: 'hosted' }))
                    }
                    disabled={!hostedReady}
                  >
                    <Link2 size={21} />
                    <span>
                      <strong>Secure payment link</strong>
                      <small>
                        {hostedReady
                          ? 'Send or open a provider-hosted checkout'
                          : 'Temporarily unavailable; ask an administrator'}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      flow.method === 'terminal' ? s.selectedMethod : ''
                    }
                    onClick={() =>
                      setFlow((current) => ({ ...current, method: 'terminal' }))
                    }
                    disabled={!terminalReady}
                  >
                    <CreditCard size={21} />
                    <span>
                      <strong>Physical terminal</strong>
                      <small>
                        {terminalReady
                          ? 'Payer is present at the front desk'
                          : 'Not configured in this environment'}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={flow.method === 'manual' ? s.selectedMethod : ''}
                    onClick={() =>
                      setFlow((current) => ({ ...current, method: 'manual' }))
                    }
                  >
                    <Banknote size={21} />
                    <span>
                      <strong>Non-card payment</strong>
                      <small>
                        Cash, check, transfer, money order, or Zelle
                      </small>
                    </span>
                  </button>
                </div>
                {flow.method === 'manual' && (
                  <div className={s.formGrid}>
                    <label>
                      Method
                      <select
                        value={flow.manualMethod}
                        onChange={(event) =>
                          setFlow((current) => ({
                            ...current,
                            manualMethod: event.target.value,
                          }))
                        }
                      >
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="money_order">Money order</option>
                        <option value="zelle">Zelle</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Reference
                      <input
                        value={flow.reference}
                        onChange={(event) =>
                          setFlow((current) => ({
                            ...current,
                            reference: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className={s.wide}>
                      Audit note
                      <input
                        value={flow.manualNote}
                        onChange={(event) =>
                          setFlow((current) => ({
                            ...current,
                            manualNote: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                )}
                {flow.method === 'terminal' && (
                  <div className={s.warning}>
                    <AlertTriangle size={18} />
                    <span>
                      A timeout is unknown—not paid. Reconciliation must resolve
                      it before another attempt.
                    </span>
                  </div>
                )}
              </div>
            )}

            {flow.step === 3 && (
              <div className={s.stepContent}>
                <div className={s.reviewCard}>
                  <div>
                    <span>Student</span>
                    <strong>{studentName}</strong>
                  </div>
                  <div>
                    <span>Payer</span>
                    <strong>{payerName}</strong>
                  </div>
                  <div>
                    <span>Payment covers</span>
                    <strong>
                      {flow.mode === 'registration'
                        ? ITEM_OPTIONS.find(
                            (item) => item.code === registration.itemCode,
                          )?.label
                        : flow.intent === 'account_credit'
                          ? 'Account credit'
                          : selectedCharge?.description}
                    </strong>
                  </div>
                  {flow.mode === 'registration' && <RegistrationPricingReview quote={reviewedRegistrationQuote} canOverridePricing={canOverridePricing} />}
                  {flow.mode === 'payment' && <TuitionPricingReview charge={selectedCharge} canOverridePricing={canOverridePricing} />}
                  <div>
                    <span>Amount</span>
                    <strong>{paymentAmount}</strong>
                  </div>
                  <div>
                    <span>Method</span>
                    <strong>
                      {flow.method === 'hosted'
                        ? 'Secure payment link'
                        : flow.method === 'terminal'
                          ? 'Physical terminal'
                          : flow.manualMethod.replaceAll('_', ' ')}
                    </strong>
                  </div>
                </div>
                <div className={s.confirmation}>
                  <ShieldCheck size={20} />
                  <span>
                    <strong>One authoritative transaction</strong>
                    <small>
                      Confirmation updates the provider/manual record,
                      allocation, ledger, activity, and receipt without a second
                      payment system.
                    </small>
                  </span>
                </div>
                {flow.completed && hostedLink && (
                  <div className={s.linkReveal}>
                    <div>
                      <strong>Secure checkout ready</strong>
                      <span>
                        Copy or open it now; the token is not stored in CRM.
                      </span>
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(hostedLink.checkoutUrl)
                      }
                    >
                      <Clipboard size={15} /> Copy
                    </button>
                    <a
                      className="btn btn-primary"
                      href={hostedLink.checkoutUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open <ExternalLink size={15} />
                    </a>
                  </div>
                )}
                {flow.completed && terminalResult && (
                  <div className={s.terminalResult}>
                    <CreditCard size={18} />
                    <span>
                      <strong>
                        Terminal result:{' '}
                        {terminalResult.outcome?.replaceAll('_', ' ')}
                      </strong>
                      <small>
                        {terminalResult.recoveryGuidance ||
                          'Provider verification completed.'}
                      </small>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={s.flowFooter}>
            <button
              className="btn"
              type="button"
              onClick={() =>
                flow.step
                  ? setFlow((current) => ({
                      ...current,
                      step: current.step - 1,
                    }))
                  : closeFlow()
              }
              disabled={Boolean(saving) || flow.completed}
            >
              <ArrowLeft size={15} /> {flow.step ? 'Back' : 'Cancel'}
            </button>
            {flow.step < 3 ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={nextStep}
              >
                Continue <ArrowRight size={15} />
              </button>
            ) : flow.completed ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={closeFlow}
              >
                Done
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                onClick={confirmFlow}
                disabled={Boolean(saving)}
              >
                {saving
                  ? 'Confirming…'
                  : flow.method === 'terminal'
                    ? 'Start terminal payment'
                    : flow.method === 'manual'
                      ? 'Record payment'
                      : 'Create secure link'}
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          <div className={s.workspaceToolbar}>
            <div className={s.viewsWrap}>
              <nav className={s.views} aria-label="Payments workspaces">
                {WORKSPACE_VIEWS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={view === item.key ? s.activeView : ''}
                    onClick={() => {
                      setView(item.key);
                      setPage(1);
                      setMobileDetail(false);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.key === 'balances' && (
                      <b>
                        {(payload?.queue?.counts?.due || 0) +
                          (payload?.queue?.counts?.partially_paid || 0)}
                      </b>
                    )}
                    {item.key === 'overdue' && (
                      <b>{payload?.queue?.counts?.overdue || 0}</b>
                    )}
                    {item.key === 'recent' && (
                      <b>{payload?.setup?.recentPayments?.length || 0}</b>
                    )}
                    {item.key === 'reconciliation' && (
                      <b>{payload?.setup?.reconciliation?.length || 0}</b>
                    )}
                  </button>
                ))}
              </nav>
              <span className={s.scrollCue} aria-hidden="true">
                <ChevronRight size={14} />
              </span>
            </div>
            <button
              className={`btn ${s.refreshButton}`}
              type="button"
              onClick={load}
              disabled={loading}
              aria-label="Refresh payments"
            >
              <RefreshCw size={16} className={loading ? s.spin : ''} />
              <span>Refresh</span>
            </button>
          </div>
          <div className={s.searchRow}>
            {view === 'balances' && (
              <div className={s.balanceToggles}>
                {BALANCE_LANES.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={lane === item.key ? s.activeToggle : ''}
                    onClick={() => {
                      setLane(item.key);
                      setPage(1);
                    }}
                  >
                    {item.label}{' '}
                    <b>{payload?.queue?.counts?.[item.key] || 0}</b>
                  </button>
                ))}
              </div>
            )}
            {(view === 'balances' || view === 'overdue') && (
              <label className={s.queueSearch}>
                <Search size={16} />
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search student"
                />
              </label>
            )}
          </div>

          {(view === 'balances' || view === 'overdue') &&
            !payload?.queue?.total && (
              <section className={s.listPanel}>
                <div className={s.empty}>
                  <CheckCircle2 size={30} />
                  <h3>This workspace is clear</h3>
                  <p>No balances match the selected state and search.</p>
                </div>
              </section>
            )}

          {(view === 'balances' || view === 'overdue') &&
            Boolean(payload?.queue?.total) && (
              <div
                className={`${s.workspace} ${mobileDetail ? s.mobileDetail : ''}`}
              >
                <section className={s.queue} aria-busy={loading}>
                  <div className={s.panelHead}>
                    <div>
                      <span>
                        {view === 'overdue'
                          ? 'Overdue'
                          : BALANCE_LANES.find((item) => item.key === lane)
                              ?.label}
                      </span>
                      <h2>
                        {payload?.queue?.total || 0} open balance
                        {payload?.queue?.total === 1 ? '' : 's'}
                      </h2>
                    </div>
                  </div>
                  <div className={s.queueItems}>
                    {payload?.queue?.items?.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`${s.queueItem} ${selectedId === item.id ? s.selected : ''}`}
                        onClick={() => {
                          setSelectedId(item.id);
                          setMobileDetail(true);
                        }}
                      >
                        <span className={s.avatar}>
                          {item.studentName?.slice(0, 1)?.toUpperCase() || '?'}
                        </span>
                        <span className={s.queueCopy}>
                          <strong>{item.studentName}</strong>
                          <small>{item.description}</small>
                          <em>{dateLabel(item.originalDueDate)}</em>
                        </span>
                        <span className={s.money}>
                          <strong>{dollars(item.balance)}</strong>
                          <small>of {dollars(item.amount)}</small>
                        </span>
                      </button>
                    ))}
                    {!payload?.queue?.items?.length && (
                      <div className={s.empty}>
                        <CheckCircle2 size={30} />
                        <h3>This workspace is clear</h3>
                        <p>No balances match the selected state and search.</p>
                      </div>
                    )}
                  </div>
                  {totalPages > 1 && (
                    <div className={s.pagination}>
                      <button
                        className="btn"
                        disabled={page <= 1}
                        onClick={() => setPage((current) => current - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        {page} / {totalPages}
                      </span>
                      <button
                        className="btn"
                        disabled={page >= totalPages}
                        onClick={() => setPage((current) => current + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </section>
                <section className={s.detail}>
                  <button
                    className={s.mobileBack}
                    type="button"
                    onClick={() => setMobileDetail(false)}
                  >
                    <ArrowLeft size={15} /> Balances
                  </button>
                  {selected ? (
                    <>
                      <div className={s.studentHead}>
                        <span className={s.largeAvatar}>
                          <UserRound size={24} />
                        </span>
                        <div>
                          <span>Student</span>
                          <h2>{selected.studentName}</h2>
                          <p>
                            {[selected.studentEmail, selected.studentPhone]
                              .filter(Boolean)
                              .join(' · ') || 'No email or phone recorded'}
                          </p>
                        </div>
                        <span className={`${s.badge} ${s[selected.state]}`}>
                          {selected.state.replace('_', ' ')}
                        </span>
                      </div>
                      <div className={s.amountBand}>
                        <div>
                          <span>Balance</span>
                          <strong>{dollars(selected.balance)}</strong>
                        </div>
                        <div>
                          <span>Original charge</span>
                          <b>{dollars(selected.amount)}</b>
                        </div>
                        <div>
                          <span>Paid</span>
                          <b>{dollars(selected.allocated)}</b>
                        </div>
                        <div>
                          <span>Due date</span>
                          <b>{dateLabel(selected.originalDueDate)}</b>
                        </div>
                      </div>
                      <div className={s.identityGrid}>
                        <div>
                          <span>Payer</span>
                          <strong>
                            {selected.payerName || selected.studentName}
                          </strong>
                        </div>
                        <div>
                          <span>Enrollment</span>
                          <strong>
                            {selected.courseName || 'Placement pending'}
                          </strong>
                          <small>
                            {selected.sectionKey || 'Section not assigned'}
                          </small>
                        </div>
                        <div>
                          <span>Charge</span>
                          <strong>{selected.description}</strong>
                          <small>
                            {selected.chargeType.replaceAll('_', ' ')}
                          </small>
                        </div>
                        <div>
                          <span>Fulfillment</span>
                          <strong>
                            {selected.fulfillment?.deliveryMode ||
                              'Not required'}
                          </strong>
                          <small>
                            {selected.fulfillment?.status ||
                              'No book fulfillment'}
                          </small>
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() =>
                          openFlow('payment', selected.studentContactId)
                        }
                        disabled={!access.canWriteFinancials}
                      >
                        <HandCoins size={15} /> Take payment
                      </button>
                      {selected.latestTransaction && (
                        <div className={s.receipt}>
                          <Banknote size={18} />
                          <div>
                            <strong>
                              {selected.latestTransaction.provider === 'manual'
                                ? 'Staff-recorded payment'
                                : 'Provider payment'}
                            </strong>
                            <span>
                              {selected.latestTransaction.status} ·{' '}
                              {dollars(selected.latestTransaction.amount)}
                            </span>
                          </div>
                          <small>
                            {selected.latestTransaction.receiptDocumentId
                              ? 'Receipt recorded'
                              : 'No receipt yet'}
                          </small>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={s.detailEmpty}>
                      <UserRound size={34} />
                      <h2>Select an open balance</h2>
                      <p>
                        Student, payer, charge, payment, receipt, and
                        fulfillment context will appear here.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            )}

          {view === 'recent' && (
            <section className={s.listPanel}>
              <div className={s.panelHead}>
                <div>
                  <span>Verified ledger</span>
                  <h2>Recent payments</h2>
                </div>
              </div>
              <div className={s.recordList}>
                {payload?.setup?.recentPayments?.map((item) => (
                  <article key={item.id} className={s.recordRow}>
                    <span className={s.recordIcon}>
                      <ReceiptText size={18} />
                    </span>
                    <div>
                      <strong>{item.studentName}</strong>
                      <small>
                        {item.payerName && item.payerName !== item.studentName
                          ? `Payer: ${item.payerName} · `
                          : ''}
                        {item.provider === 'manual'
                          ? 'Staff recorded'
                          : `${item.provider} ${item.providerEnvironment}`}
                      </small>
                      <em>
                        {dateTimeLabel(item.verifiedAt || item.occurredAt)}
                      </em>
                    </div>
                    <span className={s.recordAmount}>
                      <strong>{dollars(item.amount)}</strong>
                      <small>
                        {item.receiptNumber ||
                          (item.receiptDocumentId
                            ? 'Receipt recorded'
                            : 'Receipt pending')}
                      </small>
                    </span>
                  </article>
                ))}
                {!payload?.setup?.recentPayments?.length && (
                  <div className={s.empty}>
                    <ReceiptText size={30} />
                    <h3>No verified payments yet</h3>
                    <p>
                      Provider-confirmed and staff-recorded payments will appear
                      here.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {view === 'reconciliation' && (
            <section className={s.listPanel}>
              <div className={s.panelHead}>
                <div>
                  <span>Needs review</span>
                  <h2>Reconciliation</h2>
                </div>
              </div>
              <div className={s.recordList}>
                {payload?.setup?.reconciliation?.map((item) => (
                  <article key={item.id} className={s.recordRow}>
                    <span className={`${s.recordIcon} ${s.warningIcon}`}>
                      <AlertTriangle size={18} />
                    </span>
                    <div>
                      <strong>{item.studentName}</strong>
                      <small>
                        {item.merchantReference} · {paymentAttemptState(item)}
                      </small>
                      <em>Updated {dateTimeLabel(item.updatedAt)}</em>
                    </div>
                    <span className={s.recordAmount}>
                      <strong>{dollars(item.requestedAmount)}</strong>
                      {item.metadata?.terminalPaymentAttempt && (
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={Boolean(saving)}
                          onClick={() => recoverTerminal(item.id)}
                        >
                          <RotateCcw size={14} /> Check status
                        </button>
                      )}
                    </span>
                  </article>
                ))}
                {!payload?.setup?.reconciliation?.length && (
                  <div className={s.empty}>
                    <ShieldCheck size={30} />
                    <h3>No payment attempts need review</h3>
                    <p>
                      Unknown terminal results and uncertain provider attempts
                      will appear here.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
