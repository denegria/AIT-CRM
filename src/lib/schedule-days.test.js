import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalScheduleDays } from './schedule-days.js';

test('legacy AIT USA schedule labels normalize to canonical weekdays', () => {
  const cases = [
    [['DOMINGOS'], ['Sunday']],
    [['LUN', 'MAR', 'MIE', 'JUE'], ['Monday', 'Tuesday', 'Wednesday', 'Thursday']],
    [['LUN', 'MAR', 'MIER'], ['Monday', 'Tuesday', 'Wednesday']],
    [['LUN', 'MIE', 'VIE'], ['Monday', 'Wednesday', 'Friday']],
    [['LUNES -MARTES - MIERCOLES - JUEVES'], ['Monday', 'Tuesday', 'Wednesday', 'Thursday']],
    [['MARTES - MIERCOLES - JUEVES'], ['Tuesday', 'Wednesday', 'Thursday']],
    [['MON', 'TUE', 'WED', 'THUES.'], ['Monday', 'Tuesday', 'Wednesday', 'Thursday']],
    [['MONDAY AND TUESDAY'], ['Monday', 'Tuesday']],
    [['MONDAY TO THURSDAY'], ['Monday', 'Tuesday', 'Wednesday', 'Thursday']],
    [['SABADOS'], ['Saturday']],
    [['VIERNES'], ['Friday']],
    [[], []],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(canonicalScheduleDays(input), expected);
  }
});
