import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./Sidebar.js', import.meta.url), 'utf8');

test('mobile navigation uses a compact Active Classes label without changing desktop copy', () => {
  assert.match(source, /label: 'Active Classes', mobileLabel: 'Classes'/);
  assert.match(source, /label: item\.mobileLabel \|\| item\.label/);
});
