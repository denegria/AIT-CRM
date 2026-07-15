import assert from 'node:assert/strict';
import test from 'node:test';
import { toTaskContactOption } from './contact-options.js';

test('task contact options preserve compact workflow and follow-up profile context', () => {
  const option = toTaskContactOption({
    id: 'contact-1',
    name: 'Ada Lead',
    phone: '+15555550123',
    email: 'ada@example.com',
    primaryBusinessUnitId: 'bu-usa',
    leadId: 'lead-1',
    leadStatus: 'Contacted',
    currentStage: 'Contacted',
    assignedUserId: 'user-1',
    sourceName: 'Wix Website Form',
    programInterest: 'CNA',
    preferredDay: 'Monday',
  }, new Map([['bu-usa', { id: 'bu-usa', name: 'AIT USA Institute' }]]));

  assert.deepEqual(option, {
    id: 'contact-1',
    name: 'Ada Lead',
    companyName: '',
    email: 'ada@example.com',
    phone: '+15555550123',
    address: '',
    businessUnitId: 'bu-usa',
    primaryBusinessUnitId: 'bu-usa',
    businessUnitName: 'AIT USA Institute',
    status: 'Follow Up',
    currentStage: 'Follow Up',
    workflowKey: 'ait_usa',
    source: 'Wix Website Form',
    assignedTo: 'user-1',
    programInterest: 'CNA',
    preferredDay: 'Monday',
    preferredSchedule: '',
    testInterest: '',
    educationLevel: '',
    schoolName: '',
    locationPreference: '',
  });
});
