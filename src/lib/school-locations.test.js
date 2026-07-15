import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIT_USA_SCHOOL_LOCATIONS,
  canonicalAitUsaSchoolLocation,
  schoolLocationOptions,
  schoolLocationForContact,
  studentLocationForContact,
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

test('school location options never promote legacy or student geography values', () => {
  assert.deepEqual(schoolLocationOptions('Newark'), AIT_USA_SCHOOL_LOCATIONS);
  assert.deepEqual(schoolLocationOptions('Plainfield'), AIT_USA_SCHOOL_LOCATIONS);
  assert.equal(schoolLocationOptions().includes('Hybrid'), false);
  assert.equal(schoolLocationOptions().includes('Madrid, Spain'), false);
});

test('school location helpers keep Madrid out of campus semantics', () => {
  assert.equal(canonicalAitUsaSchoolLocation('Madrid, Spain'), '');
  assert.equal(schoolLocationForContact({ address: 'Madrid, Spain' }), '');
});

test('school location matching reads canonical contact location fields only', () => {
  assert.equal(schoolLocationForContact({ address: 'plainfield' }), 'Plainfield');
  assert.equal(schoolLocationForContact({ locationPreference: 'Piscataway' }), '');
  assert.equal(schoolLocationForContact({ enrollmentSignals: { inquiry: { location: 'Online' } } }), '');
});

test('student and intended learning locations remain separate', () => {
  const contact = { address: 'Online', locationPreference: 'Madrid, Spain' };
  assert.equal(schoolLocationForContact(contact), 'Online');
  assert.equal(studentLocationForContact(contact), 'Madrid, Spain');
  assert.equal(studentLocationForContact({ address: 'Newark' }), 'Newark');
  assert.equal(studentLocationForContact({ address: 'Plainfield' }), '');
});
