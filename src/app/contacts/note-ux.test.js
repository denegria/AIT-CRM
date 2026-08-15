import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildContactProfilePatch } from '../../lib/crm/contact-profile-patch.js';

const directorySource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const detailSource = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');

test('contact directory renders the initial note only for new contacts and keeps edit payloads timeline-free', () => {
  assert.match(directorySource, /<ContactDialogInitialTimelineNote\s+isNewContact=\{drawer === 'new'\}/);
  assert.doesNotMatch(directorySource, /Append timeline note/);
  assert.match(directorySource, /delete payload\.notes;\s+delete payload\.timeline;/);
  assert.match(directorySource, /if \(drawer === 'new'\) \{\s+payload\.appendNote/s);
  assert.match(directorySource, /\} else \{\s+delete payload\.appendNote;\s+\}/s);
});

test('contact detail keeps profile edits note-free and gives the timeline composer safe submit behavior', () => {
  assert.match(detailSource, /const profilePatch = buildContactProfilePatch\(\{/);
  assert.match(detailSource, /const \[noteSaving, setNoteSaving\] = useState\(false\);/);
  assert.match(detailSource, /const noteSaveInFlight = useRef\(false\);/);
  assert.match(detailSource, /if \(!noteInput\.trim\(\) \|\| !access\.canWriteCrm \|\| noteSaving \|\| noteSaveInFlight\.current\) return;/);
  assert.match(detailSource, /noteSaveInFlight\.current = true;\s+setNoteSaving\(true\);/);
  assert.match(detailSource, /noteSaveInFlight\.current = false;\s+setNoteSaving\(false\);/);
  assert.match(detailSource, /await save;\s+setNoteInput\(''\);\s+setTimelineReloadKey/s);
});

test('contact profile patch helper strips notes and timeline collections', () => {
  const profilePatch = buildContactProfilePatch({
    editForm: { id: 'contact-1', name: 'Ada', notes: [{ id: 'note-1' }], timeline: [{ id: 'event-1' }] },
  });
  assert.equal(Object.hasOwn(profilePatch, 'notes'), false);
  assert.equal(Object.hasOwn(profilePatch, 'timeline'), false);
});

test('saved timeline notes identify their internal type and retain an authorized author fallback', () => {
  assert.match(detailSource, /if \(timelineCategory\(item\) === 'note'\) return 'Internal note';/);
  assert.match(detailSource, /return item\.actor\?\.name \|\| 'Unknown user';/);
});
