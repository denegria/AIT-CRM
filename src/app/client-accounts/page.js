'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  ClipboardList,
  ExternalLink,
  Mail,
  Phone,
  ReceiptText,
  Search,
  UserRound,
} from 'lucide-react';
import { useCRM } from '@/lib/store';
import s from './ClientAccounts.module.css';

const ACCOUNT_LIMIT = 1000;

function cleanText(value) {
  return String(value || '').trim();
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function AccountContact({ account }) {
  if (account.primaryContactMethod?.value) {
    const methodValue = account.primaryContactMethod.type === 'phone'
      ? formatPhone(account.primaryContactMethod.value)
      : account.primaryContactMethod.value;
    return (
      <span className={s.iconLine}>
        {account.primaryContactMethod.type === 'email' ? <Mail size={14} /> : <Phone size={14} />}
        {methodValue}
      </span>
    );
  }
  if (account.primaryPersonName) {
    return (
      <span className={s.iconLine}>
        <UserRound size={14} />
        {account.primaryPersonName}
      </span>
    );
  }
  return <span className={s.muted}>No contact method</span>;
}

function accountActivity(account) {
  const parts = [
    countLabel(account.linkedContactCount || 0, 'contact'),
    countLabel(account.workOrderCount || 0, 'work order'),
    countLabel(account.estimateCount || 0, 'estimate'),
  ];
  return parts.join(' · ');
}

function MatchReasons({ account }) {
  if (account.matchReasons?.length) {
    return (
      <div className={s.reasonList}>
        {account.matchReasons.slice(0, 2).map((reason) => (
          <span key={reason.code}>{reason.label}</span>
        ))}
      </div>
    );
  }
  return <span className={s.muted}>{account.businessUnitName || 'Account'}</span>;
}

export default function ClientAccountsPage() {
  const router = useRouter();
  const {
    loaded,
    currentBusinessUnitId,
    currentBusinessUnit,
    accessibleBusinessUnits,
  } = useCRM();
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [requestState, setRequestState] = useState({ loading: true, error: '' });

  const isNonAccountDivision = Boolean(
    loaded &&
    currentBusinessUnit &&
    currentBusinessUnitId !== 'all' &&
    currentBusinessUnit.name !== 'AIT Signs',
  );

  useEffect(() => {
    if (isNonAccountDivision) {
      router.replace('/contacts');
    }
  }, [isNonAccountDivision, router]);

  const activeBusinessUnitId = useMemo(() => {
    if (!loaded) return '';
    if (currentBusinessUnitId === 'all' || currentBusinessUnitId === 'unassigned') return '';
    return currentBusinessUnitId || '';
  }, [currentBusinessUnitId, loaded]);

  useEffect(() => {
    if (!loaded || isNonAccountDivision) return undefined;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setRequestState({ loading: true, error: '' });
      try {
        const params = new URLSearchParams({
          limit: String(ACCOUNT_LIMIT),
        });
        const query = cleanText(search);
        if (query) params.set('q', query);
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
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [activeBusinessUnitId, isNonAccountDivision, loaded, search]);

  const summary = useMemo(() => {
    const linkedContacts = accounts.reduce((sum, account) => sum + (account.linkedContactCount || 0), 0);
    const workOrders = accounts.reduce((sum, account) => sum + (account.workOrderCount || 0), 0);
    const estimates = accounts.reduce((sum, account) => sum + (account.estimateCount || 0), 0);
    return { linkedContacts, workOrders, estimates };
  }, [accounts]);

  if (!loaded || isNonAccountDivision) return <div className="empty-state">Loading...</div>;

  return (
    <div className={s.page + ' fade-in'}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">
            {accounts.length} accounts in {currentBusinessUnit?.name || 'available divisions'}
          </p>
        </div>
        <div className={s.headerMetrics} aria-label="Client account summary">
          <div>
            <strong>{summary.linkedContacts}</strong>
            <span>Contacts</span>
          </div>
          <div>
            <strong>{summary.workOrders}</strong>
            <span>Work Orders</span>
          </div>
          <div>
            <strong>{summary.estimates}</strong>
            <span>Estimates</span>
          </div>
        </div>
      </div>

      <div className={s.toolbar}>
        <div className={s.searchWrap}>
          <Search size={16} />
          <input
            className={s.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search client accounts"
            placeholder="Search accounts, people, phone, work orders..."
          />
        </div>
        <div className={s.scopeHint}>
          <Building2 size={14} />
          <span>{currentBusinessUnit?.name || `${accessibleBusinessUnits.length} divisions`}</span>
        </div>
      </div>

      {requestState.error && <div className="empty-state">{requestState.error}</div>}

      {!requestState.error && requestState.loading && (
        <div className="empty-state">Loading...</div>
      )}

      {!requestState.error && !requestState.loading && accounts.length === 0 && (
        <div className="empty-state">No records found</div>
      )}

      {!requestState.error && !requestState.loading && accounts.length > 0 && (
        <div className={s.directory}>
          <div className={s.tableHeader}>
            <span>Account</span>
            <span>Contact</span>
            <span>Activity</span>
            <span>Match</span>
            <span />
          </div>
          {accounts.map((account) => (
            <Link className={s.row} href={`/client-accounts/${account.id}`} key={account.id}>
              <div className={s.accountCell}>
                <strong>{account.displayName}</strong>
                {!!account.visibleAliases?.length && (
                  <span>{account.visibleAliases.slice(0, 2).join(' · ')}</span>
                )}
              </div>
              <div><AccountContact account={account} /></div>
              <div className={s.activityCell}>
                <span><ClipboardList size={14} /> {accountActivity(account)}</span>
                {(account.latestWorkOrderNumber || account.latestEstimateNumber) && (
                  <small>
                    {account.latestWorkOrderNumber || account.latestEstimateNumber}
                    {account.latestEstimateNumber && <ReceiptText size={12} />}
                  </small>
                )}
              </div>
              <div><MatchReasons account={account} /></div>
              <div className={s.openCell} aria-hidden="true">
                <ExternalLink size={16} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
