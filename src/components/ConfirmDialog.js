'use client';
import Modal from './Modal';
import { AlertCircle } from 'lucide-react';

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', variant = 'danger' }) {
  return (
    <Modal 
      open={open} 
      onClose={onClose} 
      title={title || 'Confirmation'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={() => {
            onConfirm();
            onClose();
          }}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '8px 0' }}>
        <div style={{ 
          color: variant === 'danger' ? 'var(--danger)' : 'var(--accent)',
          background: variant === 'danger' ? 'var(--danger-muted)' : 'var(--accent-muted)',
          padding: 8,
          borderRadius: '50%',
          display: 'flex'
        }}>
          <AlertCircle size={24} />
        </div>
        <div>
          <p style={{ color: 'var(--text-primary)', fontSize: 'var(--text-md)', fontWeight: 500, marginBottom: 4 }}>
            {title}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
            {message}
          </p>
        </div>
      </div>
    </Modal>
  );
}
