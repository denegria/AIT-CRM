import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIT_USA_CAMPAIGN_MARKETS,
  AIT_USA_SCHOOL_LOCATIONS,
  campaignMarketOptions,
  canonicalAitUsaSchoolLocation,
  schoolLocationOptions,
  schoolLocationForContact,
} from './school-locations.js';

test('AIT USA school location options include exactly the active school locations', () => {
  assert.deepEqual(AIT_USA_SCHOOL_LOCATIONS, [
    'Bound Brook',
    'Plainfield',
    'Piscataway',
    'Flemington',
    'Online',
  ]);
});

test('school location options preserve a legacy current value', () => {
  assert.deepEqual(schoolLocationOptions('Newark'), [
    'Newark',
    'Bound Brook',
    'Plainfield',
    'Piscataway',
    'Flemington',
    'Online',
  ]);
  assert.deepEqual(schoolLocationOptions('Plainfield'), AIT_USA_SCHOOL_LOCATIONS);
});

test('school location helpers keep Madrid out of campus semantics', () => {
  assert.equal(canonicalAitUsaSchoolLocation('Madrid, Spain'), '');
  assert.equal(schoolLocationForContact({ address: 'Madrid, Spain' }), '');
  assert.deepEqual(AIT_USA_CAMPAIGN_MARKETS, ['Madrid, Spain']);
  assert.deepEqual(campaignMarketOptions('Madrid, Spain'), ['Madrid, Spain']);
});

test('school location matching reads canonical contact location fields only', () => {
  assert.equal(schoolLocationForContact({ address: 'plainfield' }), 'Plainfield');
  assert.equal(schoolLocationForContact({ locationPreference: 'Piscataway' }), 'Piscataway');
  assert.equal(
    schoolLocationForContact({ enrollmentSignals: { inquiry: { location: 'Online' } } }),
    'Online',
  );
});
