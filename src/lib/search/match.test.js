import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesSearchValues,
  searchPattern,
  searchPhoneDigits,
} from './match.js';

test('search patterns preserve literal wildcard characters', () => {
  assert.equal(searchPattern('  maria_100%  '), '%maria\\_100\\%%');
});

test('phone search accepts normal human formatting without matching tiny digit fragments', () => {
  assert.equal(searchPhoneDigits('(732) 354-7648'), '7323547648');
  assert.equal(searchPhoneDigits('732'), '');
  assert.equal(
    matchesSearchValues('(732) 354-7648', ['Alvaro SMS Smoke'], ['+1 732-354-7648']),
    true,
  );
  assert.equal(matchesSearchValues('732', ['Alvaro SMS Smoke'], ['+1 732-354-7648']), false);
});

test('text search is trimmed, case-insensitive, and spans workflow metadata', () => {
  assert.equal(matchesSearchValues('  madrid ', ['Madrid, Spain']), true);
  assert.equal(matchesSearchValues('osha', ['OSHA 30']), true);
  assert.equal(matchesSearchValues('missing', ['Madrid, Spain']), false);
});
