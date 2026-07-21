'use client';

import { useId } from 'react';
import { X } from 'lucide-react';
import Modal from '@/components/Modal';
import { TASK_CANCELLATION_DECISIONS } from '@/lib/tasks/cancellation-policy.js';
import s from './TaskCancellationDialog.module.css';

export function TaskCancellationDialog({
  open,
  task,
  policy,
  reason,
  busy = false,
  error = '',
  onClose,
  onReasonChange,
  onSubmit,
}) {
  const reasonId = useId();
  const approvalRequired = policy?.decision === TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED;

  return (
    <Modal
      open={Boolean(open && task)}
      onClose={() => !busy && onClose?.()}
      title={approvalRequired ? 'Request task cancellation?' : 'Cancel this task?'}
      variant="dialog"
      panelClassName={s.dialog}
      footer={(
        <>
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            Keep Task
          </button>
          <button
            className={`btn ${approvalRequired ? 'btn-primary' : 'btn-danger'}`}
            type="button"
            disabled={busy || !String(reason || '').trim()}
            onClick={onSubmit}
          >
            <X size={14} />
            {approvalRequired ? 'Request Cancellation' : 'Cancel Task'}
          </button>
        </>
      )}
    >
      <div className={s.body}>
        <div className={s.notice}>
          <span>{approvalRequired ? 'Supervisor approval required' : 'Direct cancellation'}</span>
          <strong>{task?.title || 'Task'}</strong>
          <p>
            {approvalRequired
              ? 'This task is protected. Your reason will be sent with an auditable cancellation request.'
              : 'This task will leave active work immediately. Your reason will be saved in task history.'}
          </p>
        </div>
        <label className={s.field} htmlFor={reasonId}>
          <span className="form-label">Cancellation Reason *</span>
          <textarea
            id={reasonId}
            className="textarea"
            rows={4}
            value={reason || ''}
            disabled={busy}
            placeholder="Why should this task be canceled?"
            onChange={(event) => onReasonChange?.(event.target.value)}
          />
        </label>
        {error && <p className={s.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
