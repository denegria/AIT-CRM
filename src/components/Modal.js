'use client';
import { useEffect, useId, useRef } from 'react';
import s from './Modal.module.css';

let bodyScrollLockCount = 0;

export default function Modal({ open, onClose, title, children, footer, drawerClassName = '', panelClassName = '', returnFocusRef, variant = 'drawer' }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const managesDialogFocus = variant === 'dialog';
    if (managesDialogFocus) {
      previousFocusRef.current = returnFocusRef?.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    bodyScrollLockCount += 1;
    document.body.style.overflow = 'hidden';

    const focusPanel = () => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const initialFocus = panel.querySelector('[autofocus]');
      (initialFocus || panel.querySelector('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || panel).focus();
    };
    const frame = managesDialogFocus ? window.requestAnimationFrame(focusPanel) : null;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [...(panelRef.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    if (managesDialogFocus) document.addEventListener('keydown', handleKeyDown);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (managesDialogFocus) document.removeEventListener('keydown', handleKeyDown);
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
      if (bodyScrollLockCount === 0) document.body.style.overflow = '';
      if (managesDialogFocus) previousFocusRef.current?.focus?.();
    };
  }, [open, returnFocusRef, variant]);

  if (!open) return null;
  return (
    <>
      <div className={s.overlay} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`${variant === 'dialog' ? s.dialog : s.drawer} ${drawerClassName} ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex="-1"
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
