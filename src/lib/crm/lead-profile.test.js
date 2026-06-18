import test from 'node:test';
import assert from 'node:assert/strict';
import {
  leadProfilePatchFromMetaFieldData,
  leadProfilePatchFromPayload,
  leadProfilePatchFromWebsiteLead,
  leadProfilePatchToDbValues,
  leadProfileSummary,
} from './lead-profile.js';

test('extracts structured profile facts from website lead fields', () => {
  const patch = leadProfilePatchFromWebsiteLead({
    service: 'English classes',
    address: 'Newark',
    message: 'Needs weekends.',
    sourceName: 'WordPress Website Form',
    formFields: {
      preferred_day: 'Saturday',
      preferred_time: 'Morning',
      education_level: 'Beginner',
      school: 'AIT USA',
    },
  });

  assert.deepEqual(patch, {
    programInterest: 'English classes',
    preferredDay: 'Saturday',
    preferredSchedule: 'Morning',
    educationLevel: 'Beginner',
    schoolName: 'AIT USA',
    locationPreference: 'Newark',
    profileDetails: 'Needs weekends.',
    sourceDetail: 'WordPress Website Form',
  });
});

test('extracts structured profile facts from Facebook form field data', () => {
  const patch = leadProfilePatchFromMetaFieldData([
    { name: 'full_name', values: ['Ada Lovelace'] },
    { name: 'education_level', values: ['Master degree'] },
    { name: 'preferred_day', values: ['Tuesday'] },
    { name: 'test_interest', values: ['TOEFL'] },
  ]);

  assert.equal(patch.educationLevel, 'Master degree');
  assert.equal(patch.preferredDay, 'Tuesday');
  assert.equal(patch.testInterest, 'TOEFL');
  assert.equal(patch.sourceDetail, 'Facebook Ads');
});

test('normalizes user-submitted lead profile patches and DB values', () => {
  const patch = leadProfilePatchFromPayload({
    leadProfile: {
      programInterest: ' ESL ',
      preferredDay: '',
      schoolName: ' AIT ',
    },
  });

  assert.deepEqual(patch, {
    programInterest: 'ESL',
    schoolName: 'AIT',
  });
  assert.deepEqual(leadProfilePatchToDbValues(patch), {
    program_interest: 'ESL',
    school_name: 'AIT',
  });
  assert.equal(leadProfileSummary(patch), 'Program: ESL; School: AIT');
});
