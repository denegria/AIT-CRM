import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./AppShell.js', import.meta.url), 'utf8');
const globalStyles = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function preferenceKey() {
  const match = source.match(/function navigationPreferenceKey\(userId\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'per-user navigation preference key function is present');
  return new Function(`${match[0]}; return navigationPreferenceKey;`)();
}

function preferenceHelpers() {
  const start = source.indexOf('function navigationPreferenceKey');
  const end = source.indexOf('\n\nfunction AppShellContent');
  assert.notEqual(start, -1, 'navigation preference helpers are present');
  assert.notEqual(end, -1, 'navigation preference helper block is complete');
  return new Function(`${source.slice(start, end)}; return { readPinnedNavigationPreference, writePinnedNavigationPreference };`)();
}

test('navigation pin preference is namespaced to the authenticated user', () => {
  const key = preferenceKey();
  assert.equal(key('employee-a'), 'ait-crm-navigation-pinned:employee-a');
  assert.equal(key('employee-b'), 'ait-crm-navigation-pinned:employee-b');
  assert.equal(key(null), null);
});

test('AppShell restores and writes pinning per user without carrying a prior session state forward', () => {
  assert.match(source, /setPinnedNavigation\(readPinnedNavigationPreference\(authenticatedUserId\)\)/);
  assert.match(source, /setPinnedNavigationUserId\(authenticatedUserId\)/);
  assert.match(source, /pinnedNavigationUserId === authenticatedUserId/);
  assert.match(source, /writePinnedNavigationPreference\(authenticatedUserId, nextValue\)/);
});

test('stored pinning cannot leak from one authenticated user to another', () => {
  const { readPinnedNavigationPreference, writePinnedNavigationPreference } = preferenceHelpers();
  const previousWindow = globalThis.window;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const storage = new Map();

  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  };

  try {
    writePinnedNavigationPreference('employee-a', true);
    assert.equal(readPinnedNavigationPreference('employee-a'), true);
    assert.equal(readPinnedNavigationPreference('employee-b'), false);
    writePinnedNavigationPreference('employee-b', false);
    assert.equal(readPinnedNavigationPreference('employee-a'), true);
    assert.equal(readPinnedNavigationPreference('employee-b'), false);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
});

test('pinned desktop geometry reserves 232px while mobile keeps its bottom navigation geometry', () => {
  assert.match(source, /data-navigation-pinned=\{isNavigationPinned\}/);
  assert.match(source, /<Sidebar isPinned=\{isNavigationPinned\} onPinnedChange=\{handlePinnedNavigationChange\} \/>/);
  assert.match(globalStyles, /\.app-layout\[data-navigation-pinned="true"\] \.main-content \{\s*margin-left: var\(--sidebar-width\)/);
  assert.match(globalStyles, /@media \(max-width: 900px\) \{[\s\S]*?\.app-layout\[data-navigation-pinned="true"\] \.main-content \{\s*margin-left: 0;/);
});
