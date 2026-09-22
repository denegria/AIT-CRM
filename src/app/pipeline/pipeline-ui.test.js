import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const pageStyles = fs.readFileSync(new URL('./PipelinePage.module.css', import.meta.url), 'utf8');
const boardSource = fs.readFileSync(new URL('../../components/KanbanBoard.js', import.meta.url), 'utf8');
const boardStyles = fs.readFileSync(new URL('../../components/KanbanBoard.module.css', import.meta.url), 'utf8');

test('pipeline keeps a bounded independently scrolling active board', () => {
  assert.match(boardSource, /const DEFAULT_VISIBLE_CARDS = 24/);
  assert.match(boardSource, /const pageSize = DEFAULT_VISIBLE_CARDS/);
  assert.doesNotMatch(boardSource, /COMPACT_VISIBLE_CARDS/);
  assert.match(boardSource, /const visibleCards = columnCards\.slice\(0, visibleCount\)/);
  assert.match(boardSource, /Show \{Math\.min\(pageSize, remainingCount\)\} more/);
  assert.match(boardStyles, /\.fitColumns \.kanbanColumn \{[\s\S]*?height: clamp\(560px, calc\(100dvh - 200px\), 800px\)/);
  assert.match(boardStyles, /\.kanbanList \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
});

test('pipeline cards prioritize identity, next step, and contextual action', () => {
  assert.match(boardSource, /className=\{s\.cardIdentity\}/);
  assert.match(boardSource, /className=\{s\.cardNextStep\}/);
  assert.match(boardSource, /\{nextStep\.actionLabel \|\| 'Record outreach'\}/);
  assert.doesNotMatch(boardSource, /className=\{s\.cardWorkflow\}/);
  assert.doesNotMatch(boardSource, />Log follow-up<\/button>/);
  assert.match(boardStyles, /\.cardName \{[\s\S]*?font-size: 12px;/);
  assert.match(boardStyles, /\.cardSource \{[\s\S]*?font-size: 10px;[\s\S]*?font-weight: 500;/);
});

test('pipeline toolbar and close rail preserve the accepted desktop hierarchy', () => {
  assert.match(pageSource, /className="btn btn-primary" onClick=\{\(\) => nextLead/);
  assert.match(pageSource, /<button className="btn" onClick=\{\(\) => router\.push\('\/contacts'\)\}>/);
  assert.match(pageSource, /page-title \$\{s\.pipelineTitle\}/);
  assert.match(pageStyles, /\.pipelineTitle \{[\s\S]*?font-size: var\(--text-3xl\);/);
  assert.match(pageStyles, /\.boardWithClosers \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 252px;/);
  assert.match(pageStyles, /\.closedDropList \{[\s\S]*?grid-auto-rows: minmax\(84px, auto\);/);
  assert.equal((pageSource.match(/\sfitColumns\s/g) || []).length, 2);
});

test('desktop cards expose a keyboard-operable move control without repeating the current stage', () => {
  assert.match(boardSource, /aria-label=\{`Move \$\{item\.name\} to another stage`\}/);
  assert.match(boardSource, /<option value="" disabled>Move…<\/option>/);
  assert.match(boardSource, /normalizedColumns\.filter\(\(column\) => column\.id !== item\.status\)/);
});
