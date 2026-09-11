import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./Sidebar.js', import.meta.url), 'utf8');

function railTransition() {
  const match = source.match(/function sidebarRailTransition\(expanded, event\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'sidebar rail transition function is present');
  return new Function(`${match[0]}; return sidebarRailTransition;`)();
}

test('mobile navigation uses a compact Active Classes label without changing desktop copy', () => {
  assert.match(source, /label: 'Active Classes', mobileLabel: 'Classes'/);
  assert.match(source, /label: item\.mobileLabel \|\| item\.label/);
});

test('record detail context replaces the mutable global selector with a read-only division label', () => {
  assert.match(source, /const \{ recordBusinessUnit \} = useRecordScope\(\)/);
  assert.match(source, /isRecordScope \? 'Record division'/);
  assert.match(source, /aria-label=\{`Record division: \$\{displayedBusinessUnit\.name\}`\}/);
});

test('desktop rail opens deliberately and preserves focused controls until Escape or route selection', () => {
  const transition = railTransition();
  assert.equal(transition(false, { type: 'pointer-enter', pointerType: 'mouse' }), true);
  assert.equal(transition(true, { type: 'pointer-leave', pointerType: 'mouse', focusWithin: true }), true);
  assert.equal(transition(true, { type: 'pointer-leave', pointerType: 'mouse', focusWithin: false }), false);
  assert.equal(transition(false, { type: 'content-focus' }), true);
  assert.equal(transition(true, { type: 'escape' }), false);
  assert.equal(transition(true, { type: 'route-selection' }), false);
  assert.equal(transition(false, { type: 'toggle' }), true);
  assert.equal(transition(true, { type: 'toggle' }), false);
});
