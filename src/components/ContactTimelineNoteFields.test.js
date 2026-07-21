import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContactDialogInitialTimelineNote,
  InternalNoteComposer,
  isInternalNoteSubmitDisabled,
} from './ContactTimelineNoteFields.js';

const noop = () => {};

test('new-contact initial-note field renders with a real label while edit-contact renders no note field', () => {
  const newContactMarkup = renderToStaticMarkup(createElement(ContactDialogInitialTimelineNote, {
    isNewContact: true,
    value: '',
    onChange: noop,
  }));
  const editContactMarkup = renderToStaticMarkup(createElement(ContactDialogInitialTimelineNote, {
    isNewContact: false,
    value: '',
    onChange: noop,
  }));

  assert.match(newContactMarkup, /<label[^>]+for="contact-dialog-initial-note">Initial timeline note<\/label>/);
  assert.match(newContactMarkup, /It becomes the first timeline entry; saved notes cannot be edited\./);
  assert.equal(editContactMarkup, '');
});

test('internal-note composer renders an associated label and permanence helper', () => {
  const markup = renderToStaticMarkup(createElement(InternalNoteComposer, {
    value: 'Call after 4 PM.',
    canWrite: true,
    onChange: noop,
    onSubmit: noop,
    onOpenFollowUp: noop,
  }));

  assert.match(markup, /<label[^>]+for="contact-timeline-internal-note">Add internal note<\/label>/);
  assert.match(markup, /Saved notes are added to the timeline and cannot be edited\./);
  assert.match(markup, /<textarea[^>]+aria-describedby="contact-timeline-internal-note-help"/);
  assert.match(markup, />Add note<\/button>/);
});

test('internal-note submit state stays disabled for empty, read-only, and pending states', () => {
  assert.equal(isInternalNoteSubmitDisabled({ value: '', canWrite: true }), true);
  assert.equal(isInternalNoteSubmitDisabled({ value: 'A note', canWrite: false }), true);
  assert.equal(isInternalNoteSubmitDisabled({ value: 'A note', canWrite: true, pending: true }), true);
  assert.equal(isInternalNoteSubmitDisabled({ value: 'A note', canWrite: true }), false);
});
