import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import ClassManagementWorkspace from './ClassManagementWorkspace.js';

const section = { id: 'section-1', sectionKey: 'ENG-1', courseName: 'English', teacher: 'Ana',
  courseLocation: 'Bound Brook', modality: 'in_person', scheduleDays: ['Monday'],
  startTime: '09:00', endTime: '10:00', status: 'active', rosterCount: 3, revision: 1,
  upcoming: [{ revision: 2, effectiveDate: '2026-11-01', status: 'inactive', teacher: 'Ana', courseLocation: 'Bound Brook' }] };
const blockedPreview = { effectiveDate: '2026-11-01', activeEnrollmentsSpanningDate: 3,
  upcomingDates: [], willBlockDeactivation: true };

function render(capabilities, extra = {}) {
  return renderToStaticMarkup(createElement(ClassManagementWorkspace, {
    businessUnitId: 'usa', today: '2026-10-05', initialState: {
      sections: [section], capabilities, open: true, ...extra,
    },
  }));
}

test('chooser leads with human-readable class details and keeps internal key out of the list', () => {
  const html = render({ canManage: true });
  assert.match(html, /Manage classes/);
  assert.match(html, /Classes &amp; schedules/);
  assert.match(html, /English/);
  assert.match(html, /Bound Brook/);
  assert.match(html, /9:00/);
  assert.doesNotMatch(html, /ENG-1/);
  assert.doesNotMatch(html, /class-management-form/);
});

test('only indistinguishable imported classes show a secondary reference', () => {
  const html = render({ canManage: true }, { sections: [section, { ...section, id: 'section-2', sectionKey: 'ENG-2' }] });
  assert.match(html, /To distinguish this class: ENG-1/);
  assert.match(html, /To distinguish this class: ENG-2/);
});

test('editor groups controls and honors rollout-day minimum dates', () => {
  const rollout = { ...section, baselineDate: '2026-10-05' };
  const edit = render({ canManage: true }, { sections: [rollout], selectedId: 'section-1', view: 'edit' });
  assert.match(edit, /Class details/);
  assert.match(edit, /Meeting schedule/);
  assert.match(edit, /When this takes effect/);
  assert.match(edit, /Internal class code: ENG-1/);
  assert.match(edit, /type="date" min="2026-10-06"[^>]*value="2026-10-06"/);
  assert.match(edit, /Review change/);
  assert.doesNotMatch(edit, /Save class change/);

  const create = render({ canManage: true }, { sections: [rollout], view: 'edit' });
  assert.match(create, /Internal class code/);
  assert.match(create, /type="date" min="2026-10-05"[^>]*value="2026-10-05"/);
});

test('editor flags nonstandard imported schedule text for correction', () => {
  const legacy = { ...section, scheduleDays: ['VIERNES'] };
  const html = render({ canManage: true }, { sections: [legacy], selectedId: 'section-1', view: 'edit' });
  assert.match(html, /Imported schedule text: VIERNES/);
  assert.doesNotMatch(html, /type="checkbox" checked=""/);
});

test('review makes deactivation conflict visible and disables save', () => {
  const html = render({ canManage: true }, { selectedId: 'section-1', view: 'review',
    form: { ...section, effectiveDate: '2026-11-01', status: 'inactive' }, preview: blockedPreview });
  assert.match(html, /3 active enrollments span this date/);
  assert.match(html, /End or transition the enrollments/);
  assert.match(html, /<button type="button" class="btn btn-primary" disabled="">Save class change<\/button>/);
});

test('regular coordinator gets a read-only chooser without edit controls or future schedule', () => {
  const html = render({ canManage: false });
  assert.match(html, /View classes/);
  assert.match(html, /English/);
  assert.doesNotMatch(html, /Add class|Review change|Save class change|2026-11-01/);
});

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLElement.prototype.attachEvent = () => {};
globalThis.HTMLElement.prototype.detachEvent = () => {};
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.window.requestAnimationFrame = (callback) => { callback(0); return 1; };
globalThis.window.cancelAnimationFrame = () => {};
test.after(() => dom.window.close());

test('choosing a class opens the editor, then review; back to edit removes prior approval', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ClassManagementWorkspace, {
      businessUnitId: 'usa', today: '2026-10-05', initialState: {
        sections: [section], capabilities: { canManage: true }, open: true,
        preview: { ...blockedPreview, willBlockDeactivation: false },
      },
    })));
    assert.equal(container.querySelector('form'), null);
    const classButton = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('English'));
    await act(async () => classButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.ok(container.querySelector('form'));
    assert.equal(container.querySelector('button[type="submit"]').textContent.trim(), 'Review change');
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.match(container.textContent, /Impact check/);
    assert.ok(container.textContent.includes('Save class change'));
    const back = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Back to edit'));
    await act(async () => back.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.ok(container.querySelector('form'));
    assert.equal(container.textContent.includes('Save class change'), false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
