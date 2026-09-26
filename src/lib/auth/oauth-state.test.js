import test from 'node:test';
import assert from 'node:assert/strict';
import { equalOAuthState, safeOAuthReturnTo } from './oauth-state.js';

test('OAuth state requires a full-length exact match', () => {
  const state = '0123456789abcdef0123456789abcdef';
  assert.equal(equalOAuthState(state, state), true);
  assert.equal(equalOAuthState(state, `${state}x`), false);
  assert.equal(equalOAuthState('short', 'short'), false);
});

test('return paths remain same-origin', () => {
  assert.equal(safeOAuthReturnTo('/contacts?view=mine'), '/contacts?view=mine');
  assert.equal(safeOAuthReturnTo('//evil.example/path'), '/');
  assert.equal(safeOAuthReturnTo('https://evil.example/path'), '/');
});
