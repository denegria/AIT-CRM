'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Archive,
  ArrowLeft,
  Building2,
  ClipboardList,
  Clock3,
  Link2,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  UserRound,
} from 'lucide-react';
import s from './AccountDetail.module.css';

function cleanText(value) {
  return String(value || '').trim();
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function money(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(number);
}

function formatPhone(value) {
  const raw = cleanText(value);
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function methodDisplayValue(method) {
  if (!method?.value) return '';
  return method.type === 'phone' ? formatPhone(method.value) : method.value;
}

function contactHref(method) {
  if (!method?.value) return '';
  if (method.type === 'email') return `mailto:${method.value}`;
  if (method.type === 'phone') return `tel:${method.value.replace(/[^\d+]/g, '')}`;
  return '';
}

function contactSummary(contact) {
  return [
    formatPhone(contact.phone),
    contact.email,
    contact.sourceLabel,
  ].filter(Boolean).join(' · ');
}

function Panel({ title, icon: Icon, children, count }) {
  return (
    <section className={s.panel}>
      <div className={s.panelHeader}>
        <div className={s.panelTitle}>
          <Icon size={17} />
          <span>{title}</span>
        </div>
        {Number.isFinite(count) && <span className={s.count}>{count}</span>}
      </div>
      <div className={s.panelBody}>{children}</div>
    </section>
  );
}

function EmptyRow({ children }) {
  return <div className={s.emptyRow}>{children}</div>;
}

function TimelineIcon({ type }) {
  if (type === 'estimate') return <ReceiptText size={15} />;
  if (type === 'contact') return <Link2 size={15} />;
  return <ClipboardList size={15} />;
}

export default function ClientAccountPage() {
  const params = useParams();
  const router = useRouter();
  const [account, setAccount] = useState(null);
  const [state, setState] = useState({ loading: true, error: '' });

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      setState({ loading: true, error: '' });
      try {
        const response = await fetch(`/api/client-accounts/${params.id}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Client account not found.');
        if (!cancelled) {
          setAccount(payload.account || null);
          setState({ loading: false, error: '' });
        }
      } catch (err) {
        if (!cancelled) {
          setAccount(null);
          setState({ loading: false, error: err.message || 'Client account not found.' });
        }
      }
    }

    if (params.id) loadAccount();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const timeline = useMemo(() => {
    if (!account) return [];
    return [
      ...(account.workOrders || []).map((record) => ({
        id: `work:${record.id}`,
        type: 'work',
        title: record.workOrderNumber || record.title || 'Work order',
        detail: [record.status, record.title].filter(Boolean).join(' · '),
        date: record.updatedAt || record.createdAt,
      })),
      ...(account.estimates || []).map((record) => ({
        id: `estimate:${record.id}`,
        type: 'estimate',
        title: record.estimateNumber || 'Estimate',
        detail: [record.status, money(record.total)].filter(Boolean).join(' · '),
        date: record.updatedAt || record.createdAt,
      })),
      ...(account.linkedContacts || []).map((record) => ({
        id: `contact:${record.id}`,
        type: 'contact',
        title: record.name || 'Linked contact',
        detail: [formatPhone(record.phone), record.email].filter(Boolean).join(' · '),
        href: `/contacts/${record.id}`,
        date: '',
      })),
    ].sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());
  }, [account]);

  if (state.loading) return <div className="empty-state">Loading...</div>;

  if (state.error || !account) {
    return (
      <div className={s.accountPage + ' fade-in'}>
        <button className="btn btn-ghost" type="button" onClick={() => router.back()}>
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="empty-state">{state.error || 'Client account not found.'}</div>
      </div>
    );
  }

  const primaryMethodHref = contactHref(account.primaryContactMethod);

  return (
    <div className={s.accountPage + ' fade-in'}>
      <div className={s.topBar}>
        <button className="btn btn-ghost" type="button" onClick={() => router.back()}>
          <ArrowLeft size={16} />
          Back
        </button>
        <Link className="btn btn-secondary" href="/client-accounts">
          <Building2 size={16} />
          Clients
        </Link>
      </div>

      <header className={s.hero}>
        <div className={s.heroMain}>
          <div className={s.eyebrow}>{account.businessUnitName || 'Client account'}</div>
          <h1>{account.displayName}</h1>
          <div className={s.metaLine}>
            <span className={s.status}>{account.status}</span>
            {account.primaryPersonName && <span>{account.primaryPersonName}</span>}
            {account.primaryContactMethod && (
              primaryMethodHref
                ? <a href={primaryMethodHref}>{methodDisplayValue(account.primaryContactMethod)}</a>
                : <span>{methodDisplayValue(account.primaryContactMethod)}</span>
            )}
            {account.primaryLocation?.text && <span>{account.primaryLocation.text}</span>}
          </div>
        </div>
        <div className={s.snapshotGrid} aria-label={`${account.displayName} snapshot`}>
          <div>
            <strong>{account.linkedContactCount}</strong>
            <span>Contacts</span>
          </div>
          <div>
            <strong>{account.workOrderCount}</strong>
            <span>Work Orders</span>
          </div>
          <div>
            <strong>{account.estimateCount}</strong>
            <span>Estimates</span>
          </div>
        </div>
      </header>

      {!!account.visibleAliases?.length && (
        <div className={s.aliasStrip}>
          {account.visibleAliases.map((alias) => (
            <span key={alias}>{alias}</span>
          ))}
        </div>
      )}

      <div className={s.workspaceGrid}>
        <div className={s.workspaceColumn}>
          <Panel title="Contact Methods" icon={Phone} count={account.contactMethods?.length || 0}>
            {account.contactMethods?.length ? account.contactMethods.map((method) => {
              const href = contactHref(method);
              const Icon = method.type === 'email' ? Mail : Phone;
              const displayValue = methodDisplayValue(method);
              return (
                <div className={s.listRow} key={method.id}>
                  <div className={s.iconLine}>
                    <Icon size={15} />
                    <div>
                      <strong>{href ? <a href={href}>{displayValue}</a> : displayValue}</strong>
                      <span>{method.label}</span>
                    </div>
                  </div>
                  {method.isPrimary && <span className={s.pill}>Primary</span>}
                </div>
              );
            }) : <EmptyRow>No contact methods yet.</EmptyRow>}
          </Panel>

          <Panel title="Linked Contacts" icon={Link2} count={account.linkedContacts?.length || 0}>
            {account.linkedContacts?.length ? account.linkedContacts.map((contact) => (
              <div className={s.listRow} key={contact.id}>
                <div>
                  <strong>{contact.name}</strong>
                  <span>{contactSummary(contact)}</span>
                </div>
                <Link className={s.iconButton} href={`/contacts/${contact.id}`} aria-label={`Open ${contact.name}`}>
                  <Link2 size={15} />
                </Link>
              </div>
            )) : <EmptyRow>No linked contacts yet.</EmptyRow>}
          </Panel>

          {!!account.people?.length && (
            <Panel title="People" icon={UserRound} count={account.people.length}>
              {account.people.map((person) => (
                <div className={s.listRow} key={person.id}>
                  <div>
                    <strong>{person.name}</strong>
                    <span>{person.role || 'Contact'}</span>
                  </div>
                  {person.isPrimary && <span className={s.pill}>Primary</span>}
                </div>
              ))}
            </Panel>
          )}

          {!!account.locations?.length && (
            <Panel title="Locations" icon={MapPin} count={account.locations.length}>
              {account.locations.map((location) => (
                <div className={s.listRow} key={location.id}>
                  <div>
                    <strong>{location.label || location.address || 'Location'}</strong>
                    <span>{location.text || 'No address'}</span>
                  </div>
                  {location.isPrimary && <span className={s.pill}>Primary</span>}
                </div>
              ))}
            </Panel>
          )}
        </div>

        <div className={s.workspaceColumn}>
          <Panel title="Work & Estimates" icon={ClipboardList} count={(account.workOrders?.length || 0) + (account.estimates?.length || 0)}>
            {(account.workOrders?.length || account.estimates?.length) ? (
              <>
                {(account.workOrders || []).slice(0, 5).map((record) => (
                  <div className={s.listRow} key={`work-${record.id}`}>
                    <div>
                      <strong>{record.workOrderNumber || record.title || 'Work order'}</strong>
                      <span>{[record.status, dateLabel(record.updatedAt || record.createdAt)].filter(Boolean).join(' · ')}</span>
                    </div>
                  </div>
                ))}
                {(account.estimates || []).slice(0, 5).map((record) => (
                  <div className={s.listRow} key={`estimate-${record.id}`}>
                    <div>
                      <strong>{record.estimateNumber || 'Estimate'}</strong>
                      <span>{[record.status, money(record.total), dateLabel(record.updatedAt || record.createdAt)].filter(Boolean).join(' · ')}</span>
                    </div>
                  </div>
                ))}
              </>
            ) : <EmptyRow>No work history yet.</EmptyRow>}
          </Panel>

          <Panel title="Timeline" icon={Clock3} count={timeline.length}>
            {timeline.length ? timeline.slice(0, 12).map((item) => (
              <div className={s.timelineRow} key={item.id}>
                <div className={s.timelineIcon}><TimelineIcon type={item.type} /></div>
                <div>
                  <strong>{item.href ? <Link href={item.href}>{item.title}</Link> : item.title}</strong>
                  <span>{[item.detail, dateLabel(item.date)].filter(Boolean).join(' · ')}</span>
                </div>
              </div>
            )) : <EmptyRow>No account timeline yet.</EmptyRow>}
          </Panel>
        </div>
      </div>

      <details className={s.provenance}>
        <summary>
          <Archive size={16} />
          <span>Source Provenance</span>
          <span>{account.provenanceAliases?.length || 0}</span>
        </summary>
        {account.provenanceAliases?.length ? (
          <div className={s.provenanceList}>
            {account.provenanceAliases.map((alias) => (
              <div className={s.provenanceRow} key={alias.id}>
                <strong>{alias.value}</strong>
                <span>{[alias.type, alias.sourceSheet, alias.sourceRow ? `row ${alias.sourceRow}` : ''].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyRow>No source provenance yet.</EmptyRow>
        )}
      </details>
    </div>
  );
}
