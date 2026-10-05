import { RegistrationPolicyError } from './policy.js';

const money = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

export function positiveCents(value, label = 'Final amount') {
  const raw = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) {
    throw new RegistrationPolicyError('custom_amount_invalid', `${label} must be a positive dollar amount with at most two decimals.`);
  }
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new RegistrationPolicyError('custom_amount_invalid', `${label} must be greater than zero; free waivers are not supported.`);
  }
  return cents;
}

export function adjustStaffQuote(quote, adjustment, actor) {
  if (adjustment == null) return quote;
  if (actor?.canOverridePricing !== true || !actor?.userId) {
    throw new RegistrationPolicyError('pricing_override_denied', 'Senior coordinator or administrator access is required to adjust pricing.', 403);
  }
  const reason = String(adjustment.reason || '').trim();
  if (!reason || reason.length > 500) {
    throw new RegistrationPolicyError('pricing_reason_required', 'A reason (up to 500 characters) is required for a custom final amount.');
  }
  const finals = adjustment.finalAmounts;
  if ((finals && adjustment.finalTotal != null) || (!finals && adjustment.finalTotal == null)) {
    throw new RegistrationPolicyError('pricing_adjustment_invalid', 'Supply either line final amounts or a total final amount.');
  }
  const standardTotalCents = quote.totalCents;
  const lineFinals = quote.lines.map((line) => line.amountCents);
  if (finals) {
    if (typeof finals !== 'object' || Array.isArray(finals) || !Object.keys(finals).length) {
      throw new RegistrationPolicyError('pricing_adjustment_invalid', 'Choose at least one catalog line to adjust.');
    }
    const known = new Set(quote.lines.map((line) => line.code));
    for (const [code, amount] of Object.entries(finals)) {
      if (!known.has(code)) throw new RegistrationPolicyError('pricing_item_invalid', 'Adjusted item is not in this quote.');
      const index = quote.lines.findIndex((line) => line.code === code);
      lineFinals[index] = positiveCents(amount, 'Line final amount');
    }
  } else {
    const finalTotal = positiveCents(adjustment.finalTotal, 'Total final amount');
    if (finalTotal > standardTotalCents) {
      throw new RegistrationPolicyError('pricing_surcharge_denied', 'Final amount cannot exceed the standard catalog total.');
    }
    let reduction = standardTotalCents - finalTotal;
    for (const index of quote.lines.map((_, i) => i).sort((a, b) => lineFinals[b] - lineFinals[a])) {
      const applied = Math.min(reduction, lineFinals[index] - 1);
      lineFinals[index] -= applied;
      reduction -= applied;
    }
    if (reduction) throw new RegistrationPolicyError('pricing_waiver_denied', 'Each registration charge or credit must remain positive.');
  }
  const lines = quote.lines.map((line, index) => {
    const finalAmountCents = lineFinals[index];
    if (finalAmountCents > line.amountCents) {
      throw new RegistrationPolicyError('pricing_surcharge_denied', 'Final amount cannot exceed the standard catalog rate.');
    }
    return {
      ...line,
      standardAmountCents: line.amountCents,
      standardAmount: line.amount,
      discountCents: line.amountCents - finalAmountCents,
      discount: money(line.amountCents - finalAmountCents),
      finalAmountCents,
      finalAmount: money(finalAmountCents),
      amountCents: finalAmountCents,
      amount: money(finalAmountCents),
    };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (totalCents === standardTotalCents) {
    throw new RegistrationPolicyError('pricing_discount_required', 'Custom pricing must reduce at least one catalog amount.');
  }
  return Object.freeze({
    ...quote, lines, totalCents, total: money(totalCents),
    standardTotalCents, standardTotal: money(standardTotalCents),
    discountCents: standardTotalCents - totalCents,
    discount: money(standardTotalCents - totalCents),
    pricingAdjustment: { reason, actorUserId: actor.userId, adjustedAt: new Date().toISOString() },
  });
}
