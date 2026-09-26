'use client';

import { useId, useRef, useState } from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import Modal from './Modal';
import {
  followUpOutcomeClosesFollowUp,
  followUpOutcomeAllowsProfileUpdate,
  followUpOutcomeRequiresAppointment,
  followUpOutcomeSuggestsNextDue,
  followUpQuickDueDate,
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

const QUICK_DUE_OPTIONS = Object.freeze([
  Object.freeze({ days: 1, label: 'Tomorrow' }),
  Object.freeze({ days: 2, label: '2 days' }),
  Object.freeze({ days: 3, label: '3 days' }),
]);

export const FOLLOW_UP_CHANNEL_OPTIONS = Object.freeze([
  ['phone', 'Phone'],
  ['sms', 'SMS'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
  ['in_person', 'In person'],
  ['other', 'Other'],
]);

export function followUpOutcomeImpact({ draft = {}, isTaskCompletion = false } = {}) {
  const taskEffect = isTaskCompletion ? ' Completes the selected follow-up task.' : '';
  const nextDate = draft.nextDueDate ? ' Creates the next follow-up task.' : '';
  switch (draft.outcome) {
    case 'reached_interested':
      return `Moves the inquiry to Follow Up.${taskEffect}${nextDate}`;
    case 'left_voicemail':
      return `Moves the inquiry to Follow Up.${taskEffect}${nextDate || ' Leaves the contact in the coverage queue.'}`;
    case 'no_answer':
      return `Records an unsuccessful attempt.${taskEffect}${nextDate || ' Leaves the contact in the coverage queue.'}`;
    case 'appointment_scheduled':
      return `Moves the inquiry to Follow Up and creates an appointment task for the selected date and time.${taskEffect}`;
    case 'needs_next_follow_up':
      return `Keeps the inquiry in Follow Up.${taskEffect}${nextDate || ' Leaves the contact in the coverage queue.'}`;
    case 'reached_not_interested':
      return `Moves the inquiry to Not Interested and cancels its remaining automated follow-up tasks.${taskEffect}`;
    case 'wrong_number':
      return `Marks the current phone as wrong. Email and other channels remain available.${taskEffect}`;
    case 'do_not_contact':
      return `Blocks contact, moves the inquiry to Not Interested, and cancels its remaining automated follow-up tasks.${taskEffect}`;
    case 'enrolled_or_won':
      return `Marks the opportunity as won.${taskEffect}`;
    default:
      return isTaskCompletion
        ? 'Records the outcome and completes the selected follow-up task.'
        : 'Records outreach without completing a task.';
  }
}

export function requiredFollowUpField(draft = {}, { outcomeOptions = FOLLOW_UP_OUTCOME_OPTIONS } = {}) {
  if (!outcomeOptions.some(([value]) => value === draft.outcome)) {
    return {
      field: 'outcome',
      message: draft.outcome ? 'Select a valid outcome.' : 'Select an outcome.',
    };
  }
  if (!FOLLOW_UP_CHANNEL_OPTIONS.some(([value]) => value === draft.channel)) {
    return {
      field: 'channel',
      message: draft.channel ? 'Select a valid channel.' : 'Select a channel.',
    };
  }
  if (followUpOutcomeRequiresAppointment(draft.outcome) && !String(draft.appointmentAt || '').trim()) {
    return {
      field: 'appointmentAt',
      message: 'Choose the appointment date and time.',
    };
  }
  if (!String(draft.note || '').trim()) {
    return {
      field: 'note',
      message: 'Write a note explaining the outcome.',
    };
  }
  return null;
}

export default function FollowUpOutcomeDialog({
  open,
  onClose,
  onSubmit,
  draft,
  onChange,
  onProfileChange,
  busy = false,
  submitDisabled = false,
  error = '',
  taskMatchText = '',
  ownerOptions = [],
  canManageAssignments = false,
  showProfile = false,
  isAitUsa = false,
  isTaskCompletion = false,
  title = 'Log Follow-up',
  returnFocusRef,
}) {
  const id = useId().replaceAll(':', '');
  const outcomeRef = useRef(null);
  const channelRef = useRef(null);
  const appointmentRef = useRef(null);
  const noteRef = useRef(null);
  const [validationError, setValidationError] = useState(null);

  if (!open || !draft) return null;
  const suggestsNextDue = followUpOutcomeSuggestsNextDue(draft.outcome);
  const closesFollowUp = followUpOutcomeClosesFollowUp(draft.outcome);
  const requiresAppointment = followUpOutcomeRequiresAppointment(draft.outcome);
  const outcomeOptions = isAitUsa
    ? FOLLOW_UP_OUTCOME_OPTIONS.filter(([value]) => value !== 'enrolled_or_won')
    : FOLLOW_UP_OUTCOME_OPTIONS;
  const showContactTarget = Boolean(draft.channel && draft.channel !== 'in_person');
  const showInquiryPreferences = showProfile && followUpOutcomeAllowsProfileUpdate(draft.outcome);
  const impact = followUpOutcomeImpact({ draft, isTaskCompletion });
  const fieldId = (name) => `${id}-${name}`;
  const formId = fieldId('form');

  const updateDraft = (patch) => {
    if (validationError?.field && Object.prototype.hasOwnProperty.call(patch, validationError.field)) {
      setValidationError(null);
    }
    onChange(patch);
  };

  const handleClose = () => {
    setValidationError(null);
    onClose();
  };

  const handleSubmit = (event) => {
    event?.preventDefault?.();
    const nextError = requiredFollowUpField(draft, { outcomeOptions });
    if (nextError) {
      setValidationError(nextError);
      window.requestAnimationFrame(() => {
        ({
          outcome: outcomeRef,
          channel: channelRef,
          appointmentAt: appointmentRef,
          note: noteRef,
        }[nextError.field])?.current?.focus();
      });
      return;
    }
    setValidationError(null);
    onSubmit();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      variant="dialog"
      panelClassName="follow-up-dialog-panel"
      returnFocusRef={returnFocusRef}
      footer={(
        <>
          <button className="btn" type="button" onClick={handleClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-primary"
            type="submit"
            form={formId}
            onClick={handleSubmit}
            disabled={busy || submitDisabled}
          >
            <CheckCircle2 size={16} /> {busy ? 'Saving...' : isTaskCompletion ? 'Complete follow-up' : 'Record outreach'}
          </button>
        </>
      )}
    >
      <form id={formId} className="follow-up-dialog-form" noValidate onSubmit={handleSubmit}>
        {taskMatchText && (
          <div className={`follow-up-task-match ${isTaskCompletion ? 'is-task-completion' : 'is-outreach-context'}`}>
            <div>
              <strong>{isTaskCompletion ? 'Selected task' : 'Outreach record'}</strong>
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
                    ref={outcomeRef}
                    id={fieldId('outcome')}
                    className="input select"
                    value={draft.outcome}
                    disabled={busy}
                    required
                    aria-required="true"
                    aria-invalid={validationError?.field === 'outcome'}
                    aria-describedby={validationError?.field === 'outcome' ? fieldId('outcome-error') : undefined}
                    data-autofocus
                    onChange={(event) => updateDraft({ outcome: event.target.value })}
                  >
                    <option value="" disabled>Select an outcome</option>
                    {outcomeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {validationError?.field === 'outcome' && (
                    <p id={fieldId('outcome-error')} className="form-error" role="alert" aria-live="assertive">
                      {validationError.message}
                    </p>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor={fieldId('channel')}>Channel</label>
                  <select
                    ref={channelRef}
                    id={fieldId('channel')}
                    className="input select"
                    value={draft.channel}
                    disabled={busy}
                    required
                    aria-required="true"
                    aria-invalid={validationError?.field === 'channel'}
                    aria-describedby={validationError?.field === 'channel' ? fieldId('channel-error') : undefined}
                    onChange={(event) => updateDraft({ channel: event.target.value })}
                  >
                    <option value="" disabled>Select a channel</option>
                    {FOLLOW_UP_CHANNEL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {validationError?.field === 'channel' && (
                    <p id={fieldId('channel-error')} className="form-error" role="alert" aria-live="assertive">
                      {validationError.message}
                    </p>
                  )}
                </div>
              </div>
              {showContactTarget && <div className="form-group">
                <label className="form-label" htmlFor={fieldId('contact-target')}>Number or address used <span className="form-optional">Optional</span></label>
                <input
                  id={fieldId('contact-target')}
                  className="input"
                  value={draft.contactMethod}
                  disabled={busy}
                  placeholder={draft.channel === 'email' ? 'Email address used' : 'Phone number or channel address'}
                  onChange={(event) => updateDraft({ contactMethod: event.target.value })}
                />
              </div>}
            </section>

            {!closesFollowUp && <section className="follow-up-dialog-section">
              <div className="contact-dialog-section-header">
                <span className="contact-dialog-section-index">2</span>
                <div>
                  <h2>{requiresAppointment ? 'Appointment commitment' : 'What happens next?'}</h2>
                  <p>{requiresAppointment
                    ? 'Choose the date and time promised to the student.'
                    : suggestsNextDue
                      ? 'Schedule the next attempt now, or leave it in the coverage queue.'
                      : 'Set a date when another follow-up is needed.'}</p>
                </div>
              </div>
              <div className="grid-2">
                {requiresAppointment ? <div className="form-group">
                  <label className="form-label" htmlFor={fieldId('appointment-at')}>Appointment date and time</label>
                  <input
                    ref={appointmentRef}
                    id={fieldId('appointment-at')}
                    className="input"
                    type="datetime-local"
                    value={draft.appointmentAt || ''}
                    disabled={busy}
                    required
                    aria-required="true"
                    aria-invalid={validationError?.field === 'appointmentAt'}
                    aria-describedby={validationError?.field === 'appointmentAt' ? fieldId('appointment-error') : fieldId('appointment-help')}
                    onChange={(event) => updateDraft({ appointmentAt: event.target.value, nextDueDate: '' })}
                  />
                  <p id={fieldId('appointment-help')} className="follow-up-next-due-note">An appointment task will be created in the same save.</p>
                  {validationError?.field === 'appointmentAt' && (
                    <p id={fieldId('appointment-error')} className="form-error" role="alert" aria-live="assertive">
                      {validationError.message}
                    </p>
                  )}
                </div> : <div className="form-group">
                  <label className="form-label" htmlFor={fieldId('next-due')}>
                    Next due <span className="form-optional">Optional</span>
                  </label>
                  <input
                    id={fieldId('next-due')}
                    className="input"
                    type="date"
                    value={draft.nextDueDate}
                    disabled={busy}
                    onChange={(event) => updateDraft({ nextDueDate: event.target.value })}
                  />
                  <div className="follow-up-quick-dates" role="group" aria-label="Quick next due date choices">
                    {QUICK_DUE_OPTIONS.map((option) => {
                      const value = followUpQuickDueDate(option.days);
                      return (
                        <button
                          key={option.days}
                          className="follow-up-quick-date"
                          type="button"
                          disabled={busy}
                          aria-pressed={draft.nextDueDate === value}
                          onClick={() => updateDraft({ nextDueDate: value })}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                    <button
                      className="follow-up-quick-date"
                      type="button"
                      disabled={busy}
                      aria-pressed={!draft.nextDueDate}
                      onClick={() => updateDraft({ nextDueDate: '' })}
                    >
                      No date
                    </button>
                  </div>
                  {!draft.nextDueDate && (
                    <p className={`follow-up-next-due-note ${suggestsNextDue ? 'is-warning' : ''}`} role={suggestsNextDue ? 'status' : undefined}>
                      {suggestsNextDue
                        ? 'No next task will be scheduled. Eligible contacts remain visible in Needs next follow-up.'
                        : 'Leave blank to log the outcome without scheduling another task.'}
                    </p>
                  )}
                </div>}
                {canManageAssignments && (requiresAppointment ? draft.appointmentAt : draft.nextDueDate) && (
                  <div className="form-group">
                    <label className="form-label" htmlFor={fieldId('next-owner')}>{requiresAppointment ? 'Appointment owner' : 'Next owner'}</label>
                    <select
                      id={fieldId('next-owner')}
                      className="input select"
                      value={draft.nextOwnerUserId}
                      disabled={busy}
                      onChange={(event) => updateDraft({ nextOwnerUserId: event.target.value })}
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
              ref={noteRef}
              id={fieldId('note')}
              aria-label="Required note"
              aria-required="true"
              aria-invalid={validationError?.field === 'note'}
              aria-describedby={validationError?.field === 'note' ? fieldId('note-error') : undefined}
              required
              className="textarea follow-up-note-input"
              rows={8}
              value={draft.note}
              disabled={busy}
              placeholder="Example: No answer. Left a voicemail and will call again Friday."
              onChange={(event) => updateDraft({ note: event.target.value })}
            />
            {validationError?.field === 'note' && (
              <p id={fieldId('note-error')} className="form-error" role="alert" aria-live="assertive">
                {validationError.message}
              </p>
            )}
          </section>
        </div>

        {showInquiryPreferences && (
          <details className="follow-up-profile-disclosure">
            <summary>
              <span>Update inquiry preferences</span>
              <small>Optional fields from the conversation</small>
            </summary>
            <div className="follow-up-profile-fields">
              {[
                ['programInterest', 'Program'],
                ['preferredDay', 'Preferred Day'],
                ['preferredSchedule', 'Schedule'],
                ['locationPreference', 'Student Location'],
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
              <details className="follow-up-secondary-preferences">
                <summary>Additional preferences</summary>
                <div className="follow-up-secondary-preference-grid">
                  {[
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
            </div>
          </details>
        )}

        <div className="follow-up-impact" role="status" aria-live="polite">
          <Info size={17} aria-hidden="true" />
          <div>
            <strong>This will…</strong>
            <p>{impact}</p>
          </div>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
