import assert from 'node:assert/strict';
import test from 'node:test';
import { appendContactNote, contactDetailPageState, loadContactTimeline } from './detail-loader.js';

test('contact detail waits for a route bootstrap reload before declaring not found', () => {
  assert.equal(contactDetailPageState({ loaded: false }), 'loading');
  assert.equal(contactDetailPageState({ loaded: true, deferredBootstrapActive: true }), 'loading');
  assert.equal(contactDetailPageState({ loaded: true }), 'not-found');
  assert.equal(contactDetailPageState({ loaded: true, contact: { id: 'contact-1' } }), 'ready');
});

test('contact timeline loader reads the scoped detail route without global contact collections', async () => {
  const timeline = [{ id: 'note:1', type: 'note', text: 'Scoped contact detail' }];
  const requests = [];
  const result = await loadContactTimeline('contact-1', {
    fetcher: async (...args) => {
      requests.push(args);
      return {
        ok: true,
        async json() {
          return { timeline };
        },
      };
    },
  });

  assert.deepEqual(requests, [['/api/contacts/contact-1/timeline', { cache: 'no-store' }]]);
  assert.deepEqual(result, timeline);
});

test('contact note append uses the scoped timeline route and preserves append semantics', async () => {
  const requests = [];
  const note = await appendContactNote('contact-1', 'New internal note', {
    fetcher: async (...args) => {
      requests.push(args);
      return {
        ok: true,
        async json() {
          return { note: { id: 'note-1', text: 'New internal note' } };
        },
      };
    },
  });

  assert.deepEqual(requests, [[
    '/api/contacts/contact-1/timeline',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'New internal note' }),
    },
  ]]);
  assert.equal(note.text, 'New internal note');
});

test('contact detail loader surfaces scoped access and loading failures', async () => {
  await assert.rejects(
    loadContactTimeline('contact-1', {
      fetcher: async () => ({
        ok: false,
        async json() {
          return { error: 'Insufficient business-unit access.' };
        },
      }),
    }),
    /Insufficient business-unit access/,
  );
});
