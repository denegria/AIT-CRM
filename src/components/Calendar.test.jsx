import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Calendar from './Calendar.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window;
globalThis.self = dom.window;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.document = dom.window.document;
test.after(() => dom.window.close());

test('dashboard calendar renders local follow-up time in day and list views', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    const now = new Date();
    const localDue = new Date(now.getFullYear(), now.getMonth(), 15, 14, 30);
    const date = `${localDue.getFullYear()}-${String(localDue.getMonth() + 1).padStart(2, '0')}-15`;
    act(() => root.render(createElement(Calendar, { events: [{
      id: 'task-1', title: 'Task: Follow-up', description: '', date,
      dueAt: localDue.toISOString(), type: 'deadline', href: '/tasks/task-1',
    }] })));
    assert.match(container.querySelector('.dayEvent').textContent, /2:30 PM.*Follow-up/);
    assert.match(container.querySelector('.eventItem').textContent, /2:30 PM.*Follow-up/);
  } finally {
    act(() => root.unmount());
    container.remove();
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
