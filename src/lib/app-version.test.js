import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getServerAppVersion,
  normalizeAppVersion,
  sameAppVersion,
} from './app-version.js';

test('normalizes app version markers defensively', () => {
  assert.equal(normalizeAppVersion('  abc123  '), 'abc123');
  assert.equal(normalizeAppVersion(''), '');
  assert.equal(normalizeAppVersion(null), '');
});

test('chooses the server app version from deterministic runtime sources', () => {
  assert.equal(getServerAppVersion({
    AIT_CRM_APP_VERSION: 'override',
    VERCEL_GIT_COMMIT_SHA: 'commit',
  }), 'override');
  assert.equal(getServerAppVersion({
    VERCEL_GIT_COMMIT_SHA: 'commit',
    VERCEL_DEPLOYMENT_ID: 'deployment',
  }), 'commit');
  assert.equal(getServerAppVersion({
    VERCEL_DEPLOYMENT_ID: 'deployment',
    VERCEL_URL: 'preview.example.com',
  }), 'deployment');
  assert.equal(getServerAppVersion({
    VERCEL_URL: 'preview.example.com',
    npm_package_version: '0.1.0',
  }), 'preview.example.com');
  assert.equal(getServerAppVersion({ npm_package_version: '0.1.0' }), '0.1.0');
  assert.equal(getServerAppVersion({}), 'local-dev');
});

test('compares app versions without false stale locks for missing values', () => {
  assert.equal(sameAppVersion('abc', 'abc'), true);
  assert.equal(sameAppVersion('abc', 'def'), false);
  assert.equal(sameAppVersion('', 'def'), true);
  assert.equal(sameAppVersion('abc', ''), true);
});
