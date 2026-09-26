import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/AitUsaActivityRecord.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');

test('AIT USA Activity records use one flat semantic shell', () => {
  assert.match(source, /presentation\.categoryLabel/);
  assert.match(source, /presentation\.title/);
  assert.match(source, /presentation\.statusLabel/);
  assert.match(source, /presentation\.meta/);
  assert.doesNotMatch(source, /timelineRecord/);
  assert.match(styles, /\.aitUsaActivityBody/);
  assert.match(styles, /box-shadow: none/);
});

test('Activity records distinguish semantic icons and imported provenance', () => {
  assert.match(source, /template === 'inquiry'/);
  assert.match(source, /template === 'outreach'/);
  assert.match(source, /template === 'note'/);
  assert.match(source, /template === 'task'/);
  assert.match(source, /template === 'system'/);
  assert.match(source, /presentation\.isImported/);
  assert.match(source, /<summary>Source details<\/summary>/);
});

test('long notes and outreach expose an accessible progressive disclosure', () => {
  assert.match(source, /summary\.length > 280/);
  assert.match(source, /summary\.length > 220/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /Show less/);
  assert.match(source, /Show more/);
  assert.match(styles, /-webkit-line-clamp: 5/);
  assert.match(styles, /-webkit-line-clamp: 3/);
});
