const MONEY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const TERMINAL_CHARGE_STATUSES = new Set(['waived', 'voided', 'refunded']);

function parseMoneyToCents(value, label, { allowZero }) {
  const text = String(value ?? '').trim();
  const match = text.match(MONEY_PATTERN);
  if (!match) throw new Error(`${label} must be a positive decimal with at most two fractional digits.`);
  const cents = (BigInt(match[1]) * 100n) + BigInt((match[2] || '').padEnd(2, '0'));
  if (cents < 0n || (!allowZero && cents === 0n)) throw new Error(`${label} must be greater than zero.`);
  if (cents > 999999999999n) throw new Error(`${label} exceeds the supported ledger range.`);
  return cents;
}

export function moneyToCents(value, label = 'amount') {
  return parseMoneyToCents(value, label, { allowZero: false });
}

export function nonnegativeMoneyToCents(value, label = 'amount') {
  return parseMoneyToCents(value, label, { allowZero: true });
}

export function centsToMoney(cents) {
  const value = BigInt(cents);
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function normalizeCurrency(value = 'USD') {
  const currency = String(value || '').trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new Error('currency must be a three-letter uppercase code.');
  return currency;
}

function isPastDue(dueDate, asOf) {
  if (!dueDate) return false;
  const due = String(dueDate).slice(0, 10);
  const today = (asOf instanceof Date ? asOf : new Date(asOf)).toISOString().slice(0, 10);
  return due < today;
}

export function summarizeChargeLedger({ charge, allocations = [], asOf = new Date() }) {
  const amountCents = moneyToCents(charge.amount, 'charge amount');
  let paymentCents = 0n;
  let refundCents = 0n;
  for (const allocation of allocations) {
    if (allocation.transactionStatus !== 'verified') continue;
    const cents = moneyToCents(allocation.amount, 'allocation amount');
    if (allocation.transactionKind === 'refund') refundCents += cents;
    else if (allocation.transactionKind === 'payment') paymentCents += cents;
    else throw new Error(`Unsupported transaction kind ${allocation.transactionKind}.`);
  }
  if (refundCents > paymentCents) throw new Error('Refund allocations cannot exceed verified payment allocations.');
  const netPaidCents = paymentCents - refundCents;
  if (netPaidCents > amountCents) throw new Error('Verified allocations cannot exceed the charge amount.');
  const terminal = TERMINAL_CHARGE_STATUSES.has(charge.status);
  const remainingCents = terminal ? 0n : amountCents - netPaidCents;
  let status = charge.status;
  if (!terminal) {
    if (remainingCents === 0n) status = 'paid';
    else if (isPastDue(charge.originalDueDate, asOf)) status = 'overdue';
    else if (netPaidCents > 0n) status = 'partially_paid';
    else status = 'due';
  }
  return {
    amount: centsToMoney(amountCents),
    verifiedPayments: centsToMoney(paymentCents),
    verifiedRefunds: centsToMoney(refundCents),
    netPaid: centsToMoney(netPaidCents),
    remaining: centsToMoney(remainingCents),
    status,
    originalDueDate: charge.originalDueDate || null,
  };
}

export function assertPaymentAllocation({ charge, transaction, chargeAllocated = '0.00', transactionAllocated = '0.00', amount }) {
  if (transaction.status !== 'verified') throw new Error('Only verified transactions can be allocated.');
  if (transaction.transactionKind !== 'payment') throw new Error('Refund allocation policy is not implemented in MIS-414.');
  if (!['due', 'partially_paid', 'overdue'].includes(charge.status)) {
    throw new Error(`Charge status ${charge.status} cannot accept payment allocations.`);
  }
  const chargeCurrency = normalizeCurrency(charge.currency);
  const transactionCurrency = normalizeCurrency(transaction.currency);
  if (chargeCurrency !== transactionCurrency) throw new Error('Charge and transaction currencies must match.');
  const requested = moneyToCents(amount, 'allocation amount');
  const chargeRemaining = moneyToCents(charge.amount, 'charge amount') - nonnegativeMoneyToCents(chargeAllocated, 'charge allocated amount');
  const transactionRemaining = moneyToCents(transaction.amount, 'transaction amount') - nonnegativeMoneyToCents(transactionAllocated, 'transaction allocated amount');
  if (chargeRemaining <= 0n) throw new Error('Charge has no remaining balance.');
  if (transactionRemaining <= 0n) throw new Error('Transaction has no unallocated balance.');
  if (requested > chargeRemaining) throw new Error('Allocation exceeds the charge remaining balance.');
  if (requested > transactionRemaining) throw new Error('Allocation exceeds the verified transaction balance.');
  return {
    amount: centsToMoney(requested),
    chargeRemainingAfter: centsToMoney(chargeRemaining - requested),
    transactionRemainingAfter: centsToMoney(transactionRemaining - requested),
  };
}
