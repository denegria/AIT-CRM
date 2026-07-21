import { createElement } from 'react';

export function ContactDialogInitialTimelineNote({
  isNewContact = false,
  value = '',
  onChange,
  id = 'contact-dialog-initial-note',
} = {}) {
  if (!isNewContact) return null;

  return createElement('div', { className: 'form-group' }, [
    createElement('label', { key: 'label', className: 'form-label', htmlFor: id }, 'Initial timeline note'),
    createElement('textarea', {
      key: 'textarea',
      id,
      className: 'input contact-dialog-notes',
      rows: 3,
      value,
      onChange,
    }),
    createElement(
      'div',
      { key: 'help', className: 'contact-dialog-note-help' },
      'Optional. It becomes the first timeline entry; saved notes cannot be edited.',
    ),
  ]);
}

export function isInternalNoteSubmitDisabled({
  value = '',
  canWrite = false,
  pending = false,
} = {}) {
  return !canWrite || !String(value).trim() || pending;
}

export function InternalNoteComposer({
  value = '',
  onChange,
  canWrite = false,
  pending = false,
  onSubmit,
  onOpenFollowUp,
  id = 'contact-timeline-internal-note',
  classNames = {},
} = {}) {
  const helpId = `${id}-help`;
  const submitDisabled = isInternalNoteSubmitDisabled({ value, canWrite, pending });
  const className = (name) => classNames[name] || name;
  const handleKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSubmit(event);
    }
  };

  return createElement('form', {
    className: className('noteBox'),
    onSubmit,
    'aria-label': 'Add internal note',
  }, [
    createElement('div', { key: 'header', className: className('noteBoxHeader') }, [
      createElement('label', { key: 'label', className: className('noteBoxLabel'), htmlFor: id }, 'Add internal note'),
      createElement(
        'p',
        { key: 'help', id: helpId, className: className('noteBoxHelp') },
        'Saved notes are added to the timeline and cannot be edited.',
      ),
    ]),
    createElement('textarea', {
      key: 'textarea',
      id,
      name: 'internal-note',
      value,
      onChange,
      onKeyDown: handleKeyDown,
      disabled: !canWrite || pending,
      rows: 3,
      placeholder: 'Type an internal note...',
      'aria-describedby': helpId,
    }),
    createElement('div', { key: 'footer', className: className('noteBoxFooter') }, [
      createElement(
        'button',
        { key: 'submit', className: 'btn btn-primary btn-sm', type: 'submit', disabled: submitDisabled },
        'Add note',
      ),
      createElement(
        'button',
        { key: 'follow-up', className: 'btn btn-sm', type: 'button', onClick: onOpenFollowUp, disabled: !canWrite },
        'Log Follow-up',
      ),
    ]),
  ]);
}
