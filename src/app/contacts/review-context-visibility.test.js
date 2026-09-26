import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const detailSource = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');

test('AIT USA hides the redundant review context while other workflows retain it', () => {
  assert.match(
    detailSource,
    /\{!isAitUsaContact && \(\s*<section className=\{s\.reviewContext\}/s,
  );
  assert.match(detailSource, />Review context<\/span>/);
});

test('Contact sidebar renders current or last inquiry truth and suppresses closed-state actions', () => {
  assert.match(
    detailSource,
    /\{sidebarInquiry\.heading \|\| 'Current inquiry'\}/,
  );
  assert.match(
    detailSource,
    /\{\['active', 'history'\]\.includes\(sidebarInquiry\.kind\) \? \(/,
  );
  assert.match(
    detailSource,
    /access\.canWriteCrm && sidebarNextStep\.actionType !== 'none'/,
  );
});

test('Contact sidebar polish keeps missing data quiet and separates state from action cues', () => {
  assert.match(detailSource, /NextStepActionIcon = \['first_outreach', 'retargeting', 'empty'\][\s\S]*?\? ClipboardCheck/);
  assert.match(detailSource, /className=\{s\.placeholderValue\}>Not recorded/);
  assert.match(detailSource, /\{assignedEmployee && \(/);
  assert.match(detailSource, /!inlineContactabilityStatus/);
});
