import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIT_USA_SCHOOL_LOCATIONS,
  schoolLocationOptions,
} from './school-locations.js';

test('AIT USA school location options include the active locations', () => {
  assert.deepEqual(AIT_USA_SCHOOL_LOCATIONS, ['Bound Brook', 'Plainfield']);
});

test('school location options preserve a legacy current value', () => {
  assert.deepEqual(schoolLocationOptions('Newark'), ['Newark', 'Bound Brook', 'Plainfield']);
  assert.deepEqual(schoolLocationOptions('Plainfield'), ['Bound Brook', 'Plainfield']);
});
