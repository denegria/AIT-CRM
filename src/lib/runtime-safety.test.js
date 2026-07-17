import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTERNAL_IO_DISABLED_ENV,
  externalIoDisabled,
  externalIoDisabledResponse,
} from './runtime-safety.js';

test('external I/O kill switch is fail-open only when explicitly disabled', () => {
  assert.equal(externalIoDisabled({}), false);
  assert.equal(externalIoDisabled({ [EXTERNAL_IO_DISABLED_ENV]: 'false' }), false);
  assert.equal(externalIoDisabled({ [EXTERNAL_IO_DISABLED_ENV]: 'true' }), true);
  assert.equal(externalIoDisabled({ [EXTERNAL_IO_DISABLED_ENV]: '1' }), true);
  assert.equal(externalIoDisabled({ [EXTERNAL_IO_DISABLED_ENV]: 'YES' }), true);
});

test('external I/O disabled response is safe and stable', () => {
  assert.deepEqual(externalIoDisabledResponse(), {
    error: 'External provider I/O is disabled for this environment.',
    code: 'EXTERNAL_IO_DISABLED',
  });
});
