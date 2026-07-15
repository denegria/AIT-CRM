import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIT_USA_CAMPAIGN_MARKETS,
  AIT_USA_SCHOOL_LOCATIONS,
  AIT_USA_LOCATION_FILTER_VALUES,
  campaignMarketOptions,
  canonicalAitUsaCampaignMarket,
  canonicalAitUsaSchoolLocation,
  contactLocationValues,
  marketRegionForContact,
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
  assert.equal(schoolLocationOptions().includes('Hybrid'), false);
  assert.equal(schoolLocationOptions().includes('Madrid, Spain'), false);
});

test('school location helpers keep Madrid out of campus semantics', () => {
  assert.equal(canonicalAitUsaSchoolLocation('Madrid, Spain'), '');
  assert.equal(schoolLocationForContact({ address: 'Madrid, Spain' }), '');
  assert.deepEqual(AIT_USA_CAMPAIGN_MARKETS, ['Madrid, Spain']);
  assert.deepEqual(campaignMarketOptions('Madrid, Spain'), ['Madrid, Spain']);
  assert.equal(canonicalAitUsaCampaignMarket('madrid, spain'), 'Madrid, Spain');
  assert.deepEqual(AIT_USA_LOCATION_FILTER_VALUES, [
    'Bound Brook',
    'Plainfield',
    'Piscataway',
    'Flemington',
    'Online',
    'Madrid, Spain',
  ]);
});

test('school location matching reads canonical contact location fields only', () => {
  assert.equal(schoolLocationForContact({ address: 'plainfield' }), 'Plainfield');
  assert.equal(schoolLocationForContact({ locationPreference: 'Piscataway' }), 'Piscataway');
  assert.equal(
    schoolLocationForContact({ enrollmentSignals: { inquiry: { location: 'Online' } } }),
    'Online',
  );
});

test('contact market and learning location remain separate', () => {
  const contact = { address: 'Online', locationPreference: 'Madrid, Spain' };
  assert.equal(schoolLocationForContact(contact), 'Online');
  assert.equal(marketRegionForContact(contact), 'Madrid, Spain');
  assert.deepEqual(contactLocationValues(contact), ['Online', 'Madrid, Spain']);
});
