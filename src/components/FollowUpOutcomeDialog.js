'use client';

import { useId } from 'react';
import { CheckCircle2 } from 'lucide-react';
import Modal from './Modal';
import {
  followUpOutcomeClosesFollowUp,
  followUpOutcomeRequiresNextDue,
} from '@/lib/tasks/follow-up.js';

export const FOLLOW_UP_OUTCOME_OPTIONS = Object.freeze([
  ['reached_interested', 'Reached - interested'],
  ['left_voicemail', 'Left voicemail'],
  ['no_answer', 'No answer'],
  ['appointment_scheduled', 'Appointment scheduled'],
  ['needs_next_follow_up', 'Needs next follow-up'],
  ['reached_not_interested', 'Reached - not interested'],
  ['wrong_number', 'Wrong number'],
  ['do_not_contact', 'Do not contact'],
  ['enrolled_or_won', 'Enrolled / won'],
]);

export default function FollowUpOutcomeDialog({
  open,
  onClose,
  onSubmit,
  draft,
  onChange,
  onProfileChange,
  busy = false,
  error = '',
  taskMatchText = '',
  ownerOptions = [],
  canManageAssignments = false,
  showProfile = false,
  title = 'Log Follow-up',
}) {
  const id = useId().replaceAll(':', '');
  if (!open || !draft) return null;
  const requiresNextDue = followUpOutcomeRequiresNextDue(draft.outcome);
  const closesFollowUp = followUpOutcomeClosesFollowUp(draft.outcome);
  const nextDueMissing = requiresNextDue && !draft.nextDueDate;
  const fieldId = (name) => `${id}-${name}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      variant="dialog"
      panelClassName="follow-up-dialog-panel"
      footer={(
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={onSubmit}
            disabled={busy || !draft.note.trim() || nextDueMissing}
          >
            <CheckCircle2 size={16} /> {busy ? 'Saving...' : 'Save Outcome'}
          </button>
        </>
      )}
    >
      <div className="follow-up-dialog-form">
        {taskMatchText && (
          <div className="follow-up-task-match">
            <div>
              <strong>Task match</strong>
              <p>{taskMatchText}</p>
            </div>
          </div>
        )}

        <div className="follow-up-workflow-grid">
          <div className="follow-up-workflow-stack">
            <section className="follow-up-dialog-section">
              <div className="contact-dialog-section-header">
                <span className="contact-dialog-section-index">1</span>
                <div>
                  <h2>What happened?</h2>
                  <p>Capture the result and channel before setting the next action.</p>
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor={fieldId('outcome')}>Outcome</label>
                  <select
                    id={fieldId('outcome')}
                    className="input select"
                    value={draft.outcome}
                    disabled={busy}
                    data-autofocus
                    onChange={(event) => onChange({ outcome: event.target.value })}
                  >
                    {FOLLOW_UP_OUTCOME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor={fieldId('channel')}>Channel</label>
                  <select
                    id={fieldId('channel')}
                    className="input select"
                    value={draft.channel}
                    disabled={busy}
                    onChange={(event) => onChange({ channel: event.target.value })}
                  >
                    <option value="phone">Phone</option>
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                    <option value="in_person">In person</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={fieldId('attempted')}>Attempted</label>
                <input
                  id={fieldId('attempted')}
                  className="input"
                  value={draft.contactMethod}
                  disabled={busy}
                  placeholder="Phone or email used"
                  onChange={(event) => onChange({ contactMethod: event.target.value })}
                />
              </div>
            </section>

            {!closesFollowUp && <section className="follow-up-dialog-section">
              <div className="contact-dialog-section-header">
                <span className="contact-dialog-section-index">2</span>
                <div>
                  <h2>What happens next?</h2>
                  <p>{requiresNextDue ? 'This outcome needs a dated next commitment.' : 'Set a date when another follow-up is needed.'}</p>
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor={fieldId('next-due')}>
                    Next Due {requiresNextDue ? '(required)' : '(optional)'}
                  </label>
                  <input
                    id={fieldId('next-due')}
                    className="input"
                    type="date"
                    value={draft.nextDueDate}
                    disabled={busy}
                    required={requiresNextDue}
                    aria-invalid={nextDueMissing}
                    onChange={(event) => onChange({ nextDueDate: event.target.value })}
                  />
                </div>
                {canManageAssignments && (
                  <div className="form-group">
                    <label className="form-label" htmlFor={fieldId('next-owner')}>Next Owner</label>
                    <select
                      id={fieldId('next-owner')}
                      className="input select"
                      value={draft.nextOwnerUserId}
                      disabled={busy}
                      onChange={(event) => onChange({ nextOwnerUserId: event.target.value })}
                    >
                      <option value="" disabled>Select owner</option>
                      {ownerOptions.map((owner) => (
                        <option key={owner.id} value={owner.id}>{owner.label || owner.name || owner.email}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </section>}
          </div>

          <section className="follow-up-dialog-section follow-up-note-section">
            <div className="contact-dialog-section-header">
              <span className="contact-dialog-section-index">{closesFollowUp ? '2' : '3'}</span>
              <div>
                <h2>Required note</h2>
                <p>Write the operator-readable summary that explains the outcome.</p>
              </div>
            </div>
            <textarea
              id={fieldId('note')}
              aria-label="Required note"
              className="textarea follow-up-note-input"
              rows={8}
              value={draft.note}
              disabled={busy}
              placeholder="Example: No answer. Left a voicemail and will call again Friday."
              onChange={(event) => onChange({ note: event.target.value })}
            />
          </section>
        </div>

        {showProfile && (
          <details className="follow-up-profile-disclosure">
            <summary>
              <span>Update enrollment profile</span>
              <small>Optional fields from the conversation</small>
            </summary>
            <div className="follow-up-profile-fields">
              {[
                ['programInterest', 'Program'],
                ['locationPreference', 'Student Location'],
                ['preferredDay', 'Preferred Day'],
                ['preferredSchedule', 'Schedule'],
                ['testInterest', 'Test'],
                ['educationLevel', 'Level'],
                ['schoolName', 'School'],
              ].map(([field, label]) => (
                <div className="form-group" key={field}>
                  <label className="form-label" htmlFor={fieldId(field)}>{label}</label>
                  <input
                    id={fieldId(field)}
                    className="input"
                    value={draft.leadProfile?.[field] || ''}
                    disabled={busy}
                    onChange={(event) => onProfileChange?.(field, event.target.value)}
                  />
                </div>
              ))}
            </div>
          </details>
        )}

        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
