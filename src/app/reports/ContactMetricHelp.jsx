import React, { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

export default function ContactMetricHelp({ label }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const dismissEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [open]);
  return <div ref={ref} className="reports-metric-help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!ref.current?.contains(document.activeElement)) setOpen(false); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}><button type="button" className="reports-metric-help-trigger" aria-label={`About ${label.toLowerCase()}`} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}><Info size={16} aria-hidden="true" /></button>{open && <div id={id} className="reports-metric-tooltip" role="tooltip">Contact-based rates use confirmed contacts recorded in the CRM.</div>}</div>;
}
