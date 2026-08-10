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

function Harness({ initialDraft, onSubmit, surface }) {
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
  });
}

function renderSurface(surface) {
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
      },
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
    element.value = value;
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
