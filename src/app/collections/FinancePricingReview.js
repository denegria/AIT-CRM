const dollars = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));

export function RegistrationPricingReview({ quote, canOverridePricing }) {
  if (quote?.status !== 'quoted') return null;
  return <>
    {quote.lines.map((line) => <div key={line.code}>
      <span>{line.label}</span>
      <strong>Standard {dollars(line.standardAmount || line.amount)} · Discount {dollars(line.discount || '0.00')} · Final {dollars(line.amount)}</strong>
    </div>)}
    {canOverridePricing && quote.pricingAdjustment && <div>
      <span>Adjustment reason</span><strong>{quote.pricingAdjustment.reason}</strong>
    </div>}
  </>;
}

export function TuitionPricingReview({ charge, canOverridePricing }) {
  if (!charge?.pricing) return null;
  return <>
    <div><span>Tuition pricing</span><strong>Standard {dollars(charge.pricing.standardAmount)} · Discount {dollars(charge.pricing.discount)} · Final {dollars(charge.amount)}</strong></div>
    {canOverridePricing && charge.pricing.history?.map((event, index) => <div key={`${event.eventType}:${event.createdAt}:${index}`}>
      <span>Adjustment audit · {String(event.createdAt || '').slice(0, 10)}</span>
      <strong>{dollars(event.oldAmount || event.standardAmount)} → {dollars(event.newAmount)} · {event.reason}</strong>
      <small>Actor {event.actorUserId}</small>
    </div>)}
  </>;
}
