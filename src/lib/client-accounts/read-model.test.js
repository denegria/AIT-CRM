import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLIENT_ACCOUNT_MATCH_REASONS,
  buildClientAccountResult,
  filterAndRankClientAccountResults,
} from './read-model.js';

const account = {
  id: 'account-1',
  businessUnitId: 'ait-signs',
  displayName: 'World Supermarket',
  normalizedName: 'world supermarket',
  status: 'active',
  tagsJson: ['commercial'],
};

describe('client account read model', () => {
  it('matches hidden provenance aliases without exposing them as visible names', () => {
    const result = buildClientAccountResult({
      account,
      aliases: [
        {
          id: 'alias-1',
          clientAccountId: account.id,
          value: 'Wold Supermarket',
          normalizedValue: 'wold supermarket',
          visibility: 'hidden',
          searchable: true,
          type: 'misspelling',
        },
        {
          id: 'alias-2',
          clientAccountId: account.id,
          value: 'W-Market',
          normalizedValue: 'w market',
          visibility: 'visible',
          searchable: true,
          type: 'display_alias',
        },
      ],
      query: 'wold',
    });

    assert.equal(result.title, 'World Supermarket');
    assert.deepEqual(result.visibleAliases, ['W-Market']);
    assert.deepEqual(result.matchReasonCodes, [
      CLIENT_ACCOUNT_MATCH_REASONS.HISTORICAL_SOURCE_NAME,
    ]);
    assert.equal(JSON.stringify(result).includes('Wold Supermarket'), false);
  });

  it('matches visible aliases as employee-facing aliases', () => {
    const result = buildClientAccountResult({
      account,
      aliases: [
        {
          id: 'alias-1',
          clientAccountId: account.id,
          value: 'W-Market',
          normalizedValue: 'w market',
          visibility: 'visible',
          searchable: true,
          type: 'display_alias',
        },
      ],
      query: 'w market',
    });

    assert.deepEqual(result.visibleAliases, ['W-Market']);
    assert.deepEqual(result.matchReasonCodes, [
      CLIENT_ACCOUNT_MATCH_REASONS.VISIBLE_ALIAS,
    ]);
  });

  it('matches people, contact methods, locations, work orders, and estimates', () => {
    const result = buildClientAccountResult({
      account,
      people: [
        {
          id: 'person-1',
          clientAccountId: account.id,
          name: 'Maria Santos',
          role: 'Owner',
          isPrimary: true,
        },
      ],
      contactMethods: [
        {
          id: 'method-1',
          clientAccountId: account.id,
          methodType: 'phone',
          value: '(555) 123-4444',
          normalizedValue: '5551234444',
          status: 'active',
          isPrimary: true,
        },
      ],
      locations: [
        {
          id: 'location-1',
          clientAccountId: account.id,
          label: 'Storefront',
          address: '100 Main Street',
          city: 'Yonkers',
          state: 'NY',
          postalCode: '10701',
          isPrimary: true,
        },
      ],
      linkedContacts: [
        { id: 'contact-1', clientAccountId: account.id, name: 'World Supermarket' },
      ],
      accountWorkOrders: [
        {
          id: 'wo-1',
          clientAccountId: account.id,
          workOrderNumber: 'WO-2026-10',
          title: 'Channel letters',
          status: 'open',
          updatedAt: new Date('2026-06-01T00:00:00Z'),
        },
      ],
      accountEstimates: [
        {
          id: 'est-1',
          clientAccountId: account.id,
          estimateNumber: 'EST-2026-10',
          status: 'sent',
          updatedAt: new Date('2026-06-02T00:00:00Z'),
        },
      ],
      query: '2026-10',
    });

    assert.equal(result.primaryPersonName, 'Maria Santos');
    assert.equal(result.primaryContactMethod.value, '(555) 123-4444');
    assert.equal(result.primaryLocation.city, 'Yonkers');
    assert.equal(result.latestWorkOrderNumber, 'WO-2026-10');
    assert.equal(result.latestEstimateNumber, 'EST-2026-10');
    assert.deepEqual(result.matchReasonCodes, [
      CLIENT_ACCOUNT_MATCH_REASONS.WORK_ORDER,
      CLIENT_ACCOUNT_MATCH_REASONS.ESTIMATE,
    ]);
  });

  it('filters unmatched query results and ranks account name matches first', () => {
    const results = filterAndRankClientAccountResults([
      buildClientAccountResult({
        account: { ...account, id: 'account-1', displayName: 'World Supermarket', normalizedName: 'world supermarket' },
        query: 'market',
      }),
      buildClientAccountResult({
        account: { ...account, id: 'account-2', displayName: 'Acme Hardware', normalizedName: 'acme hardware' },
        aliases: [{
          id: 'alias-1',
          clientAccountId: 'account-2',
          value: 'Market Install',
          normalizedValue: 'market install',
          visibility: 'hidden',
          searchable: true,
        }],
        query: 'market',
      }),
      buildClientAccountResult({
        account: { ...account, id: 'account-3', displayName: 'No Match', normalizedName: 'no match' },
        query: 'market',
      }),
    ], 'market', 10);

    assert.deepEqual(results.map((result) => result.id), ['account-1', 'account-2']);
  });
});
