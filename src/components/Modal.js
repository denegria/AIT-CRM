'use client';
import { useEffect, useId } from 'react';
import s from './Modal.module.css';

let bodyScrollLockCount = 0;

export default function Modal({ open, onClose, title, children, footer, drawerClassName = '', panelClassName = '', variant = 'drawer' }) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    bodyScrollLockCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
      if (bodyScrollLockCount === 0) document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className={s.overlay} onClick={onClose} aria-hidden="true" />
      <div
        className={`${variant === 'dialog' ? s.dialog : s.drawer} ${drawerClassName} ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={s.header}>
          <div className={s.title} id={titleId}>{title}</div>
          <button className={s.closeBtn} type="button" onClick={onClose} aria-label={`Close ${title}`}>✕</button>
        </div>
        <div className={s.body}>{children}</div>
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </>
  );
}
