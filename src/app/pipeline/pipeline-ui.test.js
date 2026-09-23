import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const pageStyles = fs.readFileSync(new URL('./PipelinePage.module.css', import.meta.url), 'utf8');
const boardSource = fs.readFileSync(new URL('../../components/KanbanBoard.js', import.meta.url), 'utf8');
const boardStyles = fs.readFileSync(new URL('../../components/KanbanBoard.module.css', import.meta.url), 'utf8');

test('pipeline keeps a bounded independently scrolling active board', () => {
  assert.match(pageSource, /className=\{`fade-in \$\{s\.pipelinePage\}`\}/);
  assert.match(pageStyles, /\.pipelinePage \{[\s\S]*?contain: paint;/);
  assert.match(pageStyles, /@media \(max-width: 1100px\) \{[\s\S]*?\.pipelinePage \{[\s\S]*?contain: none;/);
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
  assert.match(boardSource, /\? 'Log outreach'/);
  assert.match(boardSource, /\? 'Log follow-up'/);
  assert.match(boardSource, /\{nextStep\.actionLabel \|\| 'Log outreach'\}/);
  assert.match(pageSource, /const mobileActionLabel = \(contact\.directoryNextStepModel \|\| contactDirectoryNextStep\(contact\)\)\.actionLabel/);
  assert.match(pageSource, /\{mobileActionLabel \|\| 'Log follow-up'\}/);
  assert.doesNotMatch(boardSource, /className=\{s\.cardWorkflow\}/);
  assert.doesNotMatch(boardSource, /Start outreach|Record follow-up/);
  assert.match(boardStyles, /\.cardName \{[\s\S]*?font-size: 12px;/);
  assert.match(boardStyles, /\.cardSource \{[\s\S]*?font-size: 10px;[\s\S]*?font-weight: 500;/);
});

test('pipeline toolbar and close rail preserve the accepted desktop hierarchy', () => {
  assert.match(pageSource, /className="btn btn-primary" onClick=\{\(\) => nextLead/);
  assert.match(pageSource, /<button className="btn" onClick=\{\(\) => router\.push\('\/contacts'\)\}>/);
  assert.match(pageSource, /page-title \$\{s\.pipelineTitle\}/);
  assert.match(pageStyles, /\.pipelineTitle \{[\s\S]*?font-size: var\(--text-3xl\);/);
  assert.match(pageStyles, /\.boardWithClosers \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 252px;/);
  assert.match(pageStyles, /\.boardWithClosers \{[\s\S]*?align-items: stretch;/);
  assert.match(pageStyles, /\.closedDropList \{[\s\S]*?grid-template-rows: repeat\(var\(--closed-outcome-count, 1\), minmax\(84px, 1fr\)\);/);
  assert.match(pageStyles, /\.closedDropList \{[\s\S]*?align-content: stretch;/);
  assert.equal((pageSource.match(/\sfitColumns\s/g) || []).length, 2);
});

test('desktop cards expose a keyboard-operable move control without repeating the current stage', () => {
  assert.match(boardSource, /aria-label=\{`Move \$\{item\.name\} to another stage`\}/);
  assert.match(boardSource, /<option value="" disabled>Move…<\/option>/);
  assert.match(boardSource, /normalizedColumns\.filter\(\(column\) => column\.id !== item\.status\)/);
  assert.match(boardStyles, /\.cardMoveDesktop \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(boardStyles, /\.kanbanCard:hover \.cardMoveDesktop,[\s\S]*?\.kanbanCard:focus-within \.cardMoveDesktop \{[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/);
  assert.match(boardStyles, /@media \(pointer: coarse\) \{[\s\S]*?\.cardMoveDesktop \{[\s\S]*?opacity: 1;/);
  assert.doesNotMatch(boardStyles, /@media \(hover: none\)/);
});

test('pipeline cards remove repeated metadata without hiding operational context', () => {
  assert.match(boardSource, /const DEFAULT_AIT_USA_SOURCE = 'AIT USA Seguimiento Central Workbook'/);
  assert.match(boardSource, /normalized\(label\) === normalized\(DEFAULT_AIT_USA_SOURCE\)/);
  assert.match(boardSource, /\{source && <span className=\{s\.cardSource\}>\{source\}<\/span>\}/);
  assert.match(boardSource, /label: `Last touch · \$\{dateLabel\}`/);
  assert.match(boardSource, /aria-label=\{lastTouch\.label\} title=\{lastTouch\.title\}/);
  assert.match(boardSource, /isUnassigned \? <UserRound size=\{11\} \/> : assignedLabel\.charAt\(0\)/);
  assert.doesNotMatch(pageSource, /Drop to mark closed/);
});
