'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import DataTable from '@/components/DataTable';
import { useCRM } from '@/lib/store';

const ACCOUNT_LIMIT = 1000;

function cleanText(value) {
  return String(value || '').trim();
}

function formatPhone(value) {
  const raw = cleanText(value);
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

function contactValue(account) {
  if (account.primaryContactMethod?.value) {
    return account.primaryContactMethod.type === 'phone'
      ? formatPhone(account.primaryContactMethod.value)
      : account.primaryContactMethod.value;
  }
  return account.primaryPersonName || '';
}

function latestActivity(account) {
  return account.latestWorkOrderNumber || account.latestEstimateNumber || '';
}

function countText(count, singular, plural = `${singular}s`) {
  const value = Number(count || 0);
  return `${value} ${value === 1 ? singular : plural}`;
}

function clientRows(accounts) {
  return accounts.map((account) => {
    const contactsText = countText(account.linkedContactCount, 'contact');
    const workOrdersText = countText(account.workOrderCount, 'work order');
    const estimatesText = countText(account.estimateCount, 'estimate');
    const primaryContact = contactValue(account);
    const lastActivity = latestActivity(account);
    return {
      ...account,
      name: account.displayName,
      phone: primaryContact,
      contactsText,
      workOrdersText,
      estimatesText,
      lastActivity,
      divisionLabel: account.businessUnitName || 'AIT Signs',
      source: account.visibleAliases?.length ? account.visibleAliases.join(' ') : account.businessUnitName || 'AIT Signs',
      statusLabel: account.status || 'active',
      searchText: [
        account.displayName,
        primaryContact,
        contactsText,
        workOrdersText,
        estimatesText,
        lastActivity,
        account.businessUnitName,
        ...(account.visibleAliases || []),
        ...(account.matchReasons || []).map((reason) => reason.label),
      ].filter(Boolean).join(' '),
    };
  });
}

export default function ClientAccountsPage() {
  const router = useRouter();
  const {
    loaded,
    currentBusinessUnitId,
    currentBusinessUnit,
    accessibleBusinessUnits,
  } = useCRM();
  const [accounts, setAccounts] = useState([]);
  const [requestState, setRequestState] = useState({ loading: true, error: '' });

  const isNonAccountDivision = Boolean(
    loaded &&
    currentBusinessUnit &&
    currentBusinessUnitId !== 'all' &&
    currentBusinessUnit.name !== 'AIT Signs',
  );

  useEffect(() => {
    if (isNonAccountDivision) router.replace('/contacts');
  }, [isNonAccountDivision, router]);

  const activeBusinessUnitId = useMemo(() => {
    if (!loaded) return '';
    if (currentBusinessUnitId === 'all' || currentBusinessUnitId === 'unassigned') return '';
    return currentBusinessUnitId || '';
  }, [currentBusinessUnitId, loaded]);

  useEffect(() => {
    if (!loaded || isNonAccountDivision) return undefined;
    let cancelled = false;

    async function loadAccounts() {
      setRequestState({ loading: true, error: '' });
      try {
        const params = new URLSearchParams({ limit: String(ACCOUNT_LIMIT) });
        if (activeBusinessUnitId) params.set('businessUnitId', activeBusinessUnitId);
        const response = await fetch(`/api/client-accounts?${params.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Client accounts failed to load.');
        if (!cancelled) {
          setAccounts(payload.accounts || []);
          setRequestState({ loading: false, error: '' });
        }
      } catch (err) {
        if (!cancelled) {
          setAccounts([]);
          setRequestState({ loading: false, error: err.message || 'Client accounts failed to load.' });
        }
      }
    }

    loadAccounts();
    return () => {
      cancelled = true;
    };
  }, [activeBusinessUnitId, isNonAccountDivision, loaded]);

  const rows = useMemo(() => clientRows(accounts), [accounts]);
  const summary = useMemo(() => rows.reduce((totals, account) => ({
    contacts: totals.contacts + Number(account.linkedContactCount || 0),
    workOrders: totals.workOrders + Number(account.workOrderCount || 0),
    estimates: totals.estimates + Number(account.estimateCount || 0),
  }), { contacts: 0, workOrders: 0, estimates: 0 }), [rows]);

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'phone', label: 'Phone', sortable: true },
    { key: 'contactsText', label: 'Contacts', sortable: true },
    { key: 'workOrdersText', label: 'Work Orders', sortable: true },
    { key: 'estimatesText', label: 'Estimates', sortable: true },
    { key: 'lastActivity', label: 'Last Activity', sortable: true },
    { key: 'divisionLabel', label: 'Division', sortable: true },
    { key: 'statusLabel', label: 'Status', type: 'badge', sortable: true },
  ];

  if (!loaded || isNonAccountDivision) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">
            {accounts.length} clients in {currentBusinessUnit?.name || 'available divisions'}
          </p>
        </div>
      </div>

      <div className="contacts-facet-panel" aria-label="Client summary">
        <div className="contacts-facet-summary">
          <strong>{rows.length}</strong>
          <span>matching clients</span>
        </div>
        <div className="contacts-facet-groups">
          <div className="contacts-facet-group">
            <div className="contacts-facet-label">Activity</div>
            <div className="contacts-facet-pills">
              <span className="contacts-facet-pill active">
                <span>Contacts</span>
                <strong>{summary.contacts}</strong>
              </span>
              <span className="contacts-facet-pill">
                <span>Work Orders</span>
                <strong>{summary.workOrders}</strong>
              </span>
              <span className="contacts-facet-pill">
                <span>Estimates</span>
                <strong>{summary.estimates}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {requestState.error && <div className="empty-state">{requestState.error}</div>}
      {!requestState.error && requestState.loading && <div className="empty-state">Loading...</div>}

      {!requestState.error && !requestState.loading && (
        <div className="card" style={{ padding: 16 }}>
          <DataTable
            columns={columns}
            data={rows}
            searchPlaceholder="Search clients..."
            searchFields={['searchText']}
            toolbarExtra={(
              <div className="contacts-facet-pill" aria-label="Client division scope">
                <Building2 size={14} />
                <span>{currentBusinessUnit?.name || `${accessibleBusinessUnits.length} divisions`}</span>
              </div>
            )}
            actions={[
              { label: 'View', onClick: (row) => router.push(`/client-accounts/${row.id}`) },
            ]}
            mobileBadges={['statusLabel']}
            mobileFields={['contactsText', 'workOrdersText', 'estimatesText', 'lastActivity', 'divisionLabel']}
          />
        </div>
      )}
    </div>
  );
}
