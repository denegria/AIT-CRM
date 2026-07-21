'use client';

import { CheckCircle2, ShieldAlert, X } from 'lucide-react';
import Modal from './Modal';
import s from './TaskRemovalDecisionDialog.module.css';

function formatDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
export function TaskRemovalDecisionDialog({
  open,
  task,
  decision,
  reason,
  busy = false,
  error = '',
  onClose,
  onReasonChange,
  onSubmit,
}) {
  const metadata = task?.metadataJson || {};
  const approving = decision === 'approve';
  const denialNeedsReason = !approving && !String(reason || '').trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={approving ? 'Approve task cancellation' : 'Deny task cancellation'}
      variant="dialog"
      footer={(
        <>
          <button className="btn" type="button" disabled={busy} onClick={onClose}>Keep Pending</button>
          <button
            className={`btn ${approving ? 'btn-primary' : 'btn-danger'}`}
            type="button"
            disabled={busy || denialNeedsReason}
            onClick={onSubmit}
          >
            {approving ? <CheckCircle2 size={14} /> : <X size={14} />}
            {busy ? 'Saving…' : approving ? 'Approve Cancellation' : 'Deny Cancellation'}
          </button>
        </>
      )}
    >
      <div className={s.body}>
        <div className={s.notice}>
          <ShieldAlert size={20} aria-hidden="true" />
          <div>
            <strong>{metadata.targetTaskTitle || task?.title || 'Task cancellation request'}</strong>
            <p>
              {approving
                ? 'This removes the target task from active work and closes this approval.'
                : 'This keeps the target task active and makes cancellation available again.'}
            </p>
          </div>
        </div>
        <dl className={s.summary}>
          <div><dt>Requested by</dt><dd>{metadata.requesterName || metadata.requesterEmail || 'Coordinator'}</dd></div>
          <div><dt>Requested</dt><dd>{formatDateTime(metadata.requestedAt)}</dd></div>
          <div><dt>Queue</dt><dd>{task?.ownerUserId ? 'Assigned reviewer' : 'Shared approval queue'}</dd></div>
          <div className={s.reasonRow}><dt>Requested reason</dt><dd>{metadata.requestedReason || 'No reason recorded.'}</dd></div>
        </dl>
        <label className={s.field}>
          <span className="form-label">{approving ? 'Decision note' : 'Denial reason *'}</span>
          <textarea
            className="textarea"
            rows={4}
            value={reason || ''}
            disabled={busy}
            placeholder={approving ? 'Optional approval context' : 'Explain why this task should remain active.'}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>
        {error && <div className={s.error} role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
