'use client';
import { useEffect } from 'react';
import s from './Modal.module.css';

export default function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className={`${s.overlay} modal-overlay-fade`} onClick={onClose} />
      <div className={`${s.drawer} modal-content-slide`}>
        <div className={s.header}>
          <div className={s.title}>{title}</div>
          <button className={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={s.body}>{children}</div>
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
    </>
  );
}
