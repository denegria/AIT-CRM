import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const contactsSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const tasksSource = fs.readFileSync(new URL('../tasks/page.js', import.meta.url), 'utf8');
const dialogSource = fs.readFileSync(new URL('../../components/FollowUpOutcomeDialog.js', import.meta.url), 'utf8');

test('coverage recovery segments remain visible when their count is zero', () => {
  assert.match(contactsSource, /const ALWAYS_VISIBLE_SEGMENT_IDS = new Set\(\[\s*'needs_first_contact',\s*'needs_next_follow_up'/s);
  assert.match(contactsSource, /ALWAYS_VISIBLE_SEGMENT_IDS\.has\(facet\.id\)/);
});

test('Tasks restores focus to the Log outcome trigger when the dialog closes', () => {
  assert.match(tasksSource, /const followUpOutcomeTriggerRef = useRef\(null\);/);
  assert.match(tasksSource, /followUpOutcomeTriggerRef\.current = trigger;/);
  assert.match(tasksSource, /returnFocusRef=\{followUpOutcomeTriggerRef\}/);
  assert.match(dialogSource, /returnFocusRef,\s*\}\)/s);
  assert.match(dialogSource, /returnFocusRef=\{returnFocusRef\}/);
});
