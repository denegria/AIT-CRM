import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapModeForPathname, LEAN_SHELL_PATHS } from './bootstrap-routing.js';

test('high-traffic and service-backed routes avoid the full CRM bootstrap', () => {
  assert.equal(bootstrapModeForPathname('/'), 'dashboard');
  assert.equal(bootstrapModeForPathname('/contacts'), 'contact-directory');
  assert.equal(bootstrapModeForPathname('/pipeline'), 'pipeline');
  for (const pathname of LEAN_SHELL_PATHS) {
    assert.equal(bootstrapModeForPathname(pathname), 'lean-shell');
  }
});

test('detail and broad data workspaces keep the full bootstrap until separately scoped', () => {
  assert.equal(bootstrapModeForPathname('/tasks/task-1'), 'full');
  assert.equal(bootstrapModeForPathname('/reports'), 'full');
  assert.equal(bootstrapModeForPathname('/financials'), 'full');
  assert.equal(bootstrapModeForPathname('/work-orders'), 'full');
});
