import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import OpportunityLifecycleField from './OpportunityLifecycleField.jsx';

test('AIT USA no-Opportunity state explains the issue, offers Start opportunity, and hides the selector', () => {
  const html = renderToStaticMarkup(
    <OpportunityLifecycleField
      isAitUsa
      hasLeadStatus={false}
      status="New Lead"
      statuses={['New Lead', 'Follow Up']}
      onStatusChange={() => {}}
      onStart={() => {}}
    />,
  );

  assert.match(html, /does not have an Opportunity yet/);
  assert.match(html, /Start opportunity/);
  assert.doesNotMatch(html, /opportunity-status-selector/);
});

test('an AIT USA Contact with an Opportunity keeps the lifecycle selector', () => {
  const html = renderToStaticMarkup(
    <OpportunityLifecycleField
      isAitUsa
      hasLeadStatus
      status="Follow Up"
      statuses={['New Lead', 'Follow Up']}
      onStatusChange={() => {}}
      onStart={() => {}}
    />,
  );

  assert.match(html, /opportunity-status-selector/);
  assert.match(html, /Follow Up/);
  assert.doesNotMatch(html, /Start opportunity/);
});

test('AIT Signs keeps its existing lifecycle selector even without a Lead', () => {
  const html = renderToStaticMarkup(
    <OpportunityLifecycleField
      isAitUsa={false}
      hasLeadStatus={false}
      status="Intake"
      statuses={['Intake', 'Estimate']}
      onStatusChange={() => {}}
      onStart={() => {}}
    />,
  );
  assert.match(html, /opportunity-status-selector/);
  assert.doesNotMatch(html, /Start opportunity/);
});

test('AIT USA multiple-active conflict is explicit and renders no lifecycle selector', () => {
  const html = renderToStaticMarkup(
    <OpportunityLifecycleField
      isAitUsa
      hasLeadStatus
      opportunityConflict
      status="Follow Up"
      statuses={['New Lead', 'Follow Up']}
      onStatusChange={() => {}}
      onStart={() => {}}
    />,
  );
  assert.match(html, /Multiple active Opportunities/);
  assert.match(html, /status and owner changes are blocked/i);
  assert.doesNotMatch(html, /opportunity-status-selector/);
});
