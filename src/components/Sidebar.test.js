import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./Sidebar.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./Sidebar.module.css', import.meta.url), 'utf8');

function railTransition() {
  const match = source.match(/function sidebarRailTransition\(transientExpanded, event\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'sidebar rail transition function is present');
  return new Function(`${match[0]}; return sidebarRailTransition;`)();
}

function railState() {
  const match = source.match(/function navigationRailState\(isPinned, isTransientExpanded\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'navigation rail state function is present');
  return new Function(`${match[0]}; return navigationRailState;`)();
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

test('desktop rail keeps transient expansion separate from persistent pinning', () => {
  const transition = railTransition();
  const state = railState();
  assert.equal(transition(false, { type: 'pointer-enter', pointerType: 'mouse' }), true);
  assert.equal(transition(true, { type: 'pointer-leave', pointerType: 'mouse', focusWithin: true }), true);
  assert.equal(transition(true, { type: 'pointer-leave', pointerType: 'mouse', focusWithin: false }), false);
  assert.equal(transition(false, { type: 'content-focus' }), true);
  assert.equal(transition(true, { type: 'escape' }), false);
  assert.equal(transition(true, { type: 'route-selection' }), false);
  assert.equal(state(true, transition(true, { type: 'escape' })), 'pinned');
  assert.equal(state(true, transition(true, { type: 'route-selection' })), 'pinned');
  assert.equal(transition(false, { type: 'toggle' }), true);
  assert.equal(transition(true, { type: 'toggle' }), false);
  assert.equal(state(false, false), 'collapsed');
  assert.equal(state(false, true), 'transient');
  assert.equal(state(true, false), 'pinned');
  assert.equal(state(true, true), 'pinned');
});

test('desktop navigation exposes an explicit accessible pin control and panel affordance', () => {
  assert.match(source, /aria-label=\{isPinned \? 'Unpin navigation' : 'Pin navigation'\}/);
  assert.match(source, /aria-pressed=\{isPinned\}/);
  assert.match(source, /<PanelLeftClose size=\{18\} \/> : <PanelLeftOpen size=\{18\} \/>/);
  assert.match(source, /data-navigation-state=\{railState\}/);
  assert.match(source, /className=\{s\.railToggle\}/);
  assert.match(source, /\{isTransientExpanded \? <PanelLeftClose/);
  assert.match(source, /<MoreHorizontal \/><span>More<\/span>/);
  assert.match(source, /onClick=\{closeAfterRouteSelection\}/);
});

test('desktop expansion remains an overlay, honors reduced motion, and mobile hides pin controls', () => {
  assert.match(styles, /width: var\(--sidebar-rail-width\)/);
  assert.match(styles, /\.sidebar\[data-expanded="true"\] \{\s*width: var\(--sidebar-width\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.sidebar \{ transition: none; \}/);
  assert.match(styles, /@media \(max-width: 900px\) \{[\s\S]*?\.logo, \.navLabel, \.scopePanel, \.pinControl, \.bottom \{ display: none; \}/);
});
