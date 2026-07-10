import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mobilePipelineOwnerLabel,
  mobilePipelineSourceLabel,
  mobilePipelineTouchContext,
  mobilePipelineTriageItems,
} from './pipeline-mobile-triage.js';

const NOW = new Date('2026-07-10T12:00:00.000Z');

test('mobile pipeline triage exposes owner and source labels', () => {
  const contact = {
    assignedLabel: 'Sofia Ramirez',
    inquirySource: 'Facebook Lead Ads',
    lastTouch: '2026-07-09T14:00:00.000Z',
  };

  assert.equal(mobilePipelineOwnerLabel(contact), 'Sofia Ramirez');
  assert.equal(mobilePipelineSourceLabel(contact), 'Facebook Lead Ads');
  assert.deepEqual(
    mobilePipelineTriageItems(contact, NOW).map((item) => [item.label, item.value]),
    [
      ['Owner', 'Sofia Ramirez'],
      ['Source', 'Facebook Lead Ads'],
      ['Touch', 'Touched yesterday'],
    ],
  );
});

test('mobile pipeline triage flags unassigned stale leads', () => {
  const contact = {
    source: 'Website',
    lastTouch: '2026-05-20',
  };

  assert.equal(mobilePipelineOwnerLabel(contact), 'Unassigned');
  assert.deepEqual(mobilePipelineTouchContext(contact, NOW), {
    label: 'Stale 51d',
    tone: 'stale',
  });
});

test('mobile pipeline triage handles missing touch context', () => {
  assert.deepEqual(mobilePipelineTouchContext({}, NOW), {
    label: 'No touch recorded',
    tone: 'stale',
  });
  assert.equal(mobilePipelineSourceLabel({}), 'Unknown Source');
});
