import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIT_USA_SCHOOL_LOCATIONS,
  canonicalAitUsaSchoolLocation,
  schoolLocationOptions,
  schoolLocationForContact,
  studentLocationForContact,
  retiredAitUsaSchoolLocation,
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
  assert.deepEqual(schoolLocationOptions('Newark'), ['Bound Brook', 'Plainfield', 'Flemington', 'Online']);
  assert.deepEqual(schoolLocationOptions('Plainfield'), ['Bound Brook', 'Plainfield', 'Flemington', 'Online']);
  assert.equal(schoolLocationOptions().includes('Hybrid'), false);
  assert.equal(schoolLocationOptions().includes('Madrid, Spain'), false);
  assert.equal(schoolLocationOptions().includes('Piscataway'), false);
  assert.equal(schoolLocationOptions().includes('Somerville'), false);
});

test('retired locations remain recognizable on historical Contacts but are not new choices', () => {
  for (const location of ['Piscataway', 'Somerville']) {
    assert.equal(retiredAitUsaSchoolLocation(location.toLowerCase()), location);
    assert.equal(canonicalAitUsaSchoolLocation(location), location === 'Piscataway' ? 'Piscataway' : '');
    assert.equal(schoolLocationForContact({ address: location }), location);
    assert.equal(studentLocationForContact({ address: location }), '');
  }
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
