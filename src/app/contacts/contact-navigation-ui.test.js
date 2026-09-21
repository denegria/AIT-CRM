import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');

test('AIT USA uses one primary workspace tab row with quiet count badges', () => {
  assert.match(source, /isAitUsaContact \? 'Activity' : 'Timeline'/);
  assert.match(source, /isAitUsaContact \? 'Enrollments' : 'Courses'/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected=\{renderedActiveTab === tab\.id\}/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /className=\{s\.contentTabCount\}/);
  assert.match(styles, /\.contentTabCount/);
});

test('workspace tabs support standard keyboard navigation', () => {
  assert.match(source, /event\.key === 'ArrowRight'/);
  assert.match(source, /event\.key === 'ArrowLeft'/);
  assert.match(source, /event\.key === 'Home'/);
  assert.match(source, /event\.key === 'End'/);
  assert.match(source, /contentTabRefs\.current\[nextIndex\]\?\.focus\(\)/);
});

test('AIT USA removes the duplicate snapshot strip and keeps nonzero Activity filters', () => {
  assert.match(source, /!isAitUsaContact && \(\s*<div className=\{s\.snapshotStrip\}/);
  assert.match(source, /const visibleTimelineFilters = detailView\.timelineFilters\.filter/);
  assert.match(source, /filter\.value === 'all'/);
  assert.match(source, /filter\.value === renderedTimelineFilter/);
  assert.match(source, /timelineCounts\[filter\.value\] \|\| 0/);
  assert.match(source, /const timelineMoreFilters = isAitUsaContact/);
  assert.match(source, /\['import', 'system'\]\.includes\(filter\.value\)/);
  assert.match(source, /More\s*<span className=\{s\.timelineFilterCount\}>/);
  assert.match(source, /timelineMoreRef\.current\?\.removeAttribute\('open'\)/);
  assert.match(styles, /\.timelineMore/);
});

test('AIT USA Activity uses semantic records and import provenance facets', () => {
  assert.match(source, /timelineMatchesFilter\(item, renderedTimelineFilter, isAitUsaContact\)/);
  assert.match(source, /item\.presentation\?\.isImported/);
  assert.match(source, /<AitUsaActivityRecord/);
  assert.match(source, /timelineMoreFilters\.map\(\(filter\) =>/);
});

test('non-AIT-USA workflows retain their existing snapshot and filter path', () => {
  assert.match(source, /!isAitUsaContact && \(\s*<div className=\{s\.snapshotStrip\}/);
  assert.match(source, /if \(!isAitUsaContact\) return true;/);
});

test('AIT USA separates internal notes from structured outreach actions', () => {
  assert.match(source, /Add internal note\s*<\/button>/);
  assert.match(source, /Record outreach\s*<\/button>/);
  assert.match(source, /<MessageSquarePlus size=\{14\} \/> Add internal note/);
  assert.match(source, /<ClipboardCheck size=\{14\} \/> Record outreach/);
  assert.match(source, /noteComposerOpen \? s\.internalNoteActionActive : ''/);
  assert.match(source, /aria-expanded=\{noteComposerOpen\}/);
  assert.match(source, /isAitUsaContact && noteComposerOpen/);
  assert.match(source, /submitLabel="Save note"/);
  assert.match(source, /Internal context only\. Does not record outreach, complete tasks, or schedule follow-up\./);
  assert.match(source, /!isAitUsaContact && \(\s*<InternalNoteComposer/);
});

test('AIT USA contact context precedes the workspace in DOM order', () => {
  const desktopContext = source.indexOf('{isAitUsaContact && profileSidebar}');
  const mobileContext = source.indexOf('{isAitUsaContact && instituteMobileContext}');
  const workspace = source.indexOf('<div className={s.contentSection}>', mobileContext);

  assert.ok(desktopContext >= 0);
  assert.ok(mobileContext > desktopContext);
  assert.ok(workspace > mobileContext);
  assert.match(source, /\{!isAitUsaContact && profileSidebar\}/);
});

test('mobile AIT USA context keeps identity, exact next step, and secondary details together', () => {
  assert.match(source, /className=\{s\.mobileContactContext\}/);
  assert.match(source, /id="mobile-contact-context-name"/);
  assert.match(source, /renderInstituteNextStep\('mobile-contact-next-step', s\.mobileNextStep\)/);
  assert.match(source, /<summary>Contact and inquiry details<\/summary>/);
  assert.match(source, /Intended learning location/);
  assert.match(source, /Edit profile/);
  assert.match(source, /Archive contact/);
});

test('mobile AIT USA context replaces the desktop rail and removes empty panel height', () => {
  assert.match(styles, /\.instituteDetailLayout \.instituteProfileCard \{\s*display: none;/);
  assert.match(styles, /\.instituteDetailLayout \.mobileContactContext \{[\s\S]*?display: block;/);
  assert.match(styles, /\.instituteDetailLayout \.contentSection \{\s*order: 2;/);
  assert.match(styles, /\.instituteDetailLayout \.tabContent \{\s*min-height: 0;/);
});
