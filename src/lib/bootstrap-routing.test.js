import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapModeForPathname, LEAN_SHELL_PATHS, requiresTeamMonitorBootstrapReload } from './bootstrap-routing.js';

test('high-traffic and service-backed routes avoid the full CRM bootstrap', () => {
  assert.equal(bootstrapModeForPathname('/'), 'dashboard');
  assert.equal(bootstrapModeForPathname('/contacts'), 'contact-directory');
  assert.equal(bootstrapModeForPathname('/pipeline'), 'pipeline');
  assert.equal(bootstrapModeForPathname('/team-monitor'), 'team-monitor');
  assert.equal(bootstrapModeForPathname('/active-classes'), 'lean-shell');
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

test('team monitor client navigation requires a fresh route bootstrap on entry and exit', () => {
  assert.equal(requiresTeamMonitorBootstrapReload({ pathname: '/team-monitor', bootstrapMode: 'full' }), true);
  assert.equal(requiresTeamMonitorBootstrapReload({ pathname: '/team-monitor', bootstrapMode: 'team-monitor' }), false);
  assert.equal(requiresTeamMonitorBootstrapReload({ pathname: '/', bootstrapMode: 'team-monitor' }), true);
  assert.equal(requiresTeamMonitorBootstrapReload({ pathname: '/contacts', bootstrapMode: 'full' }), false);
});
