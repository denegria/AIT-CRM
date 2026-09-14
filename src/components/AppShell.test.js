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
  const end = source.indexOf('\n\nfunction NavigationLayout');
  assert.notEqual(start, -1, 'navigation preference helpers are present');
  assert.notEqual(end, -1, 'navigation preference helper block is complete');
  return new Function(`${source.slice(start, end)}; return { readPinnedNavigationPreference, readPinnedNavigationServerSnapshot, subscribePinnedNavigationPreference, writePinnedNavigationPreference };`)();
}

test('navigation pin preference is namespaced to the authenticated user', () => {
  const key = preferenceKey();
  assert.equal(key('employee-a'), 'ait-crm-navigation-pinned:employee-a');
  assert.equal(key('employee-b'), 'ait-crm-navigation-pinned:employee-b');
  assert.equal(key(null), null);
});

test('navigation pin store uses a false server snapshot and a same-window update notification', () => {
  const {
    readPinnedNavigationPreference,
    readPinnedNavigationServerSnapshot,
    subscribePinnedNavigationPreference,
    writePinnedNavigationPreference,
  } = preferenceHelpers();
  const previousWindow = globalThis.window;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const storage = new Map();
  const listeners = new Map();

  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: (event) => listeners.get(event.type)?.(event),
  };

  try {
    assert.equal(readPinnedNavigationServerSnapshot(), false);
    let updates = 0;
    const unsubscribe = subscribePinnedNavigationPreference('employee-a', () => { updates += 1; });
    writePinnedNavigationPreference('employee-a', true);
    assert.equal(readPinnedNavigationPreference('employee-a'), true);
    assert.equal(updates, 1);
    unsubscribe();
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
});

test('stored pinning remains isolated when the authenticated user changes', () => {
  const { readPinnedNavigationPreference, writePinnedNavigationPreference } = preferenceHelpers();
  const previousWindow = globalThis.window;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const storage = new Map();

  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    dispatchEvent: () => {},
  };

  try {
    writePinnedNavigationPreference('employee-a', true);
    writePinnedNavigationPreference('employee-b', false);

    assert.deepEqual(
      [
        readPinnedNavigationPreference('employee-a'),
        readPinnedNavigationPreference('employee-b'),
        readPinnedNavigationPreference('employee-a'),
        readPinnedNavigationPreference(null),
      ],
      [true, false, true, false],
    );
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
});

test('pinned desktop geometry reserves 232px while mobile keeps its bottom navigation geometry', () => {
  assert.ok(source.includes('useSyncExternalStore(subscribe, getSnapshot, readPinnedNavigationServerSnapshot)'));
  assert.match(source, /data-navigation-pinned=\{isNavigationPinned\}/);
  assert.match(source, /<Sidebar isPinned=\{isNavigationPinned\} onPinnedChange=\{handlePinnedNavigationChange\} \/>/);
  assert.match(globalStyles, /\.app-layout\[data-navigation-pinned="true"\] \.main-content \{\s*margin-left: var\(--sidebar-width\)/);
  assert.match(globalStyles, /@media \(max-width: 900px\) \{[\s\S]*?\.app-layout\[data-navigation-pinned="true"\] \.main-content \{\s*margin-left: 0;/);
});
