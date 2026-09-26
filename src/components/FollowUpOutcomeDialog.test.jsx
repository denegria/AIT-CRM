import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import FollowUpOutcomeDialog from './FollowUpOutcomeDialog.js';
import { initialFollowUpDraftFields } from '../lib/tasks/follow-up-draft.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLElement.prototype.attachEvent = () => {};
globalThis.HTMLElement.prototype.detachEvent = () => {};
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.window.requestAnimationFrame = (callback) => {
  callback(0);
  return 1;
};
globalThis.window.cancelAnimationFrame = () => {};

test.after(() => dom.window.close());

function Harness({ initialDraft, onSubmit, surface, componentProps = {} }) {
  const [draft, setDraft] = useState(initialDraft);
  return createElement(FollowUpOutcomeDialog, {
    open: true,
    onClose() {},
    onSubmit,
    draft,
    onChange(patch) {
      setDraft((current) => ({ ...current, ...patch }));
    },
    title: surface === 'Tasks queue' ? 'Log follow-up outcome' : 'Record outreach',
    taskMatchText: surface === 'Tasks queue' ? 'Completes this exact task.' : 'Records outreach for this Contact.',
    isTaskCompletion: surface === 'Tasks queue',
    ...componentProps,
  });
}

function renderSurface(surface, { initialDraft = {}, componentProps = {} } = {}) {
  let submitCalls = 0;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Harness, {
      surface,
      initialDraft: {
        ...initialFollowUpDraftFields(),
        note: 'Typed note survives correction.',
        nextOwnerUserId: '',
        leadProfile: {},
        ...initialDraft,
      },
      componentProps,
      onSubmit() { submitCalls += 1; },
    }));
  });
  return {
    container,
    get submitCalls() { return submitCalls; },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('AIT USA hides direct enrollment and uses an explicit Record outreach commit label', () => {
  const view = renderSurface('Contact detail', { componentProps: { isAitUsa: true } });
  try {
    const optionLabels = [...fields(view).outcome.options].map((option) => option.textContent);
    assert.equal(optionLabels.includes('Enrolled / won'), false);
    assert.equal(fields(view).save.textContent.trim(), 'Record outreach');
  } finally {
    view.cleanup();
  }
});

test('appointment scheduled requires and focuses a date and time before completing follow-up', () => {
  const view = renderSurface('Tasks queue', {
    initialDraft: {
      outcome: 'appointment_scheduled',
      channel: 'in_person',
    },
  });
  try {
    const appointment = view.container.querySelector('input[type="datetime-local"]');
    assert.ok(appointment);
    assert.equal(appointment.required, true);
    assert.equal(view.container.querySelector('[id$="contact-target"]'), null);
    assert.equal(fields(view).save.textContent.trim(), 'Complete follow-up');

    click(fields(view).save);
    assert.equal(view.submitCalls, 0);
    assert.equal(document.activeElement, appointment);
    assert.match(view.container.querySelector('[role="alert"]').textContent, /appointment date and time/i);

    assert.match(view.container.querySelector('.follow-up-impact').textContent, /creates an appointment task/i);
  } finally {
    view.cleanup();
  }

  const valid = renderSurface('Tasks queue', {
    initialDraft: {
      outcome: 'appointment_scheduled',
      channel: 'in_person',
      appointmentAt: '2026-09-22T14:30',
    },
  });
  try {
    click(fields(valid).save);
    assert.equal(valid.submitCalls, 1);
  } finally {
    valid.cleanup();
  }
});

test('required note is announced and inquiry preferences stay scoped to conversation outcomes', () => {
  const view = renderSurface('Contact detail', {
    initialDraft: {
      outcome: 'do_not_contact',
      channel: 'phone',
      note: '',
    },
    componentProps: { isAitUsa: true, showProfile: true },
  });
  try {
    assert.equal(view.container.querySelector('.follow-up-profile-disclosure'), null);
    assert.match(view.container.querySelector('.follow-up-impact').textContent, /Blocks contact/i);
    click(fields(view).save);
    assert.equal(view.submitCalls, 0);
    assert.equal(document.activeElement, fields(view).note);
    assert.equal(fields(view).note.getAttribute('aria-required'), 'true');
  } finally {
    view.cleanup();
  }

  const interested = renderSurface('Contact detail', {
    initialDraft: { outcome: 'reached_interested', channel: 'phone' },
    componentProps: { isAitUsa: true, showProfile: true },
  });
  try {
    assert.match(interested.container.querySelector('.follow-up-profile-disclosure').textContent, /Update inquiry preferences/);
    assert.match(interested.container.querySelector('.follow-up-secondary-preferences').textContent, /Additional preferences/);
  } finally {
    interested.cleanup();
  }
});

function fields(view) {
  const outcome = view.container.querySelector('select[data-autofocus]');
  const channel = [...view.container.querySelectorAll('select[required]')]
    .find((field) => field !== outcome);
  return {
    outcome,
    channel,
    note: view.container.querySelector('textarea[aria-label="Required note"]'),
    save: view.container.querySelector('button[form]'),
  };
}

function click(element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function change(element, value) {
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    if (valueSetter) valueSetter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

for (const surface of ['Tasks queue', 'Contact detail']) {
  test(`${surface} renders blank required fields and pointer submit preserves notes, announces, focuses, then saves explicit values`, () => {
    const view = renderSurface(surface);
    try {
      const { outcome, channel, note, save } = fields(view);

      assert.equal(outcome.value, '');
      assert.equal(outcome.required, true);
      assert.equal(outcome.options[0].text, 'Select an outcome');
      assert.equal(channel.value, '');
      assert.equal(channel.required, true);
      assert.equal(channel.options[0].text, 'Select a channel');

      click(save);
      assert.equal(view.submitCalls, 0);
      assert.equal(document.activeElement, outcome);
      assert.equal(view.container.querySelector('[role="alert"][aria-live="assertive"]').textContent, 'Select an outcome.');
      assert.equal(note.value, 'Typed note survives correction.');

      change(outcome, 'no_answer');
      click(save);
      assert.equal(view.submitCalls, 0);
      assert.equal(document.activeElement, channel);
      assert.equal(view.container.querySelector('[role="alert"][aria-live="assertive"]').textContent, 'Select a channel.');
      assert.equal(note.value, 'Typed note survives correction.');

      change(channel, 'phone');
      click(save);
      assert.equal(view.submitCalls, 1);
      assert.equal(note.value, 'Typed note survives correction.');
    } finally {
      view.cleanup();
    }
  });

  test(`${surface} keyboard submit keeps the dialog open and focuses the announced outcome error`, () => {
    const view = renderSurface(surface);
    try {
      const { outcome, note, save } = fields(view);
      const form = document.getElementById(save.getAttribute('form'));

      act(() => {
        save.focus();
        save.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      assert.equal(view.submitCalls, 0);
      assert.equal(document.activeElement, outcome);
      assert.equal(view.container.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
      const alert = view.container.querySelector('[role="alert"]');
      assert.equal(alert.getAttribute('aria-live'), 'assertive');
      assert.equal(alert.textContent, 'Select an outcome.');
      assert.equal(note.value, 'Typed note survives correction.');
    } finally {
      view.cleanup();
    }
  });
}
