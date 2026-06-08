'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Archive,
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  Calendar,
  ClipboardList,
  FileText,
  Link2,
  Mail,
  Phone,
  ReceiptText,
  UserRound,
} from 'lucide-react';
import s from '../../contacts/[id]/ContactDetail.module.css';

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
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

function methodDisplayValue(method) {
  if (!method?.value) return '';
  return method.type === 'phone' ? formatPhone(method.value) : method.value;
}

function methodHref(method) {
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

function timelineDateParts(item) {
  const label = dateLabel(item.date);
  return { date: label, time: '' };
}

function EmptyState({ children }) {
  return <div className={s.timelineEmpty}>{children}</div>;
}

function ContactMethod({ method }) {
  const href = methodHref(method);
  const Icon = method.type === 'email' ? Mail : Phone;
  const value = methodDisplayValue(method);
  return (
    <div className={s.infoItem}>
      <Icon size={16} />
      {href ? <a className={s.infoLink} href={href}>{value}</a> : <span>{value}</span>}
    </div>
  );
}

function RecordCard({ icon: Icon, title, subtitle, badge, href }) {
  const content = (
    <>
      <div className={s.recordMain}>
        <div className={s.recordIcon}><Icon size={20} /></div>
        <div>
          <div className={s.recordTitle}>{title}</div>
          <div className={s.recordSubtitle}>{subtitle}</div>
        </div>
      </div>
      {badge && <span className={`badge badge-${String(badge).toLowerCase().replace(/\s+/g, '')}`}>{badge}</span>}
    </>
  );
  if (href) {
    return <Link className={`${s.recordCard} ${s.recordLinkCard}`} href={href}>{content}</Link>;
  }
  return <div className={s.recordCard}>{content}</div>;
}

export default function ClientAccountPage() {
  const params = useParams();
  const router = useRouter();
  const [account, setAccount] = useState(null);
  const [activeTab, setActiveTab] = useState('timeline');
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
        type: 'Work Order',
        title: record.workOrderNumber || record.title || 'Work order',
        text: record.title || '',
        date: record.updatedAt || record.createdAt,
        icon: ClipboardList,
        toneClass: s.tone_work,
      })),
      ...(account.estimates || []).map((record) => ({
        id: `estimate:${record.id}`,
        type: 'Estimate',
        title: record.estimateNumber || 'Estimate',
        text: [record.status, money(record.total)].filter(Boolean).join(' · '),
        date: record.updatedAt || record.createdAt,
        icon: ReceiptText,
        toneClass: s.tone_estimate,
      })),
      ...(account.linkedContacts || []).map((record) => ({
        id: `contact:${record.id}`,
        type: 'Linked Contact',
        title: record.name || 'Contact',
        text: contactSummary(record),
        date: record.updatedAt || record.createdAt,
        icon: Link2,
        href: `/contacts/${record.id}`,
      })),
    ].sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());
  }, [account]);

  if (state.loading) return <div className="empty-state">Loading...</div>;

  if (state.error || !account) {
    return (
      <div className={s.detailPage + ' fade-in'}>
        <div className="page-header">
          <button className={s.btnBack} type="button" onClick={() => router.back()}>
            <ArrowLeft size={18} /> Back to Clients
          </button>
        </div>
        <div className="empty-state">{state.error || 'Client account not found.'}</div>
      </div>
    );
  }

  const primaryMethod = account.primaryContactMethod;
  const primaryMethodText = methodDisplayValue(primaryMethod);
  const firstLetter = cleanText(account.displayName).charAt(0) || 'C';
  const activeTabValue = ['timeline', 'contacts', 'workorders', 'estimates', 'source'].includes(activeTab)
    ? activeTab
    : 'timeline';

  return (
    <div className={s.detailPage + ' fade-in'}>
      <div className="page-header">
        <button className={s.btnBack} type="button" onClick={() => router.push('/client-accounts')}>
          <ArrowLeft size={18} /> Back to Clients
        </button>
      </div>

      <div className={s.detailLayout}>
        <aside className={s.profileCard}>
          <div className={s.profileHeader}>
            <div className={s.profileAvatarLarge}>{firstLetter}</div>
            <div className={s.profileTitleBlock}>
              <div className={s.profileNameRow}>
                <h1 className={s.profileName}>{account.displayName}</h1>
                <span className={`badge badge-${String(account.status || 'active').toLowerCase().replace(/\s+/g, '')}`}>
                  {account.status || 'active'}
                </span>
              </div>
              <div className={s.profileRole}>Client</div>
              <div className={s.profileSource}>{account.businessUnitName || 'AIT Signs'}</div>
            </div>
          </div>

          <div className={s.profileInfo}>
            {primaryMethod ? (
              <ContactMethod method={primaryMethod} />
            ) : (
              <div className={s.infoItem}>
                <Phone size={16} />
                <span className={s.missingInfo}>Missing primary contact method</span>
              </div>
            )}
            {!!account.contactMethods?.length && account.contactMethods
              .filter((method) => method.id !== primaryMethod?.id)
              .slice(0, 2)
              .map((method) => <ContactMethod method={method} key={method.id} />)}
            <div className={s.infoItem}>
              <Building2 size={16} />
              <span>{account.businessUnitName || 'AIT Signs'}</span>
            </div>
            <div className={s.infoItem}>
              <Calendar size={16} />
              <span>Latest: {timeline[0] ? dateLabel(timeline[0].date) : 'No activity yet'}</span>
            </div>
          </div>

          <div className={s.highlightGrid} aria-label={`${account.displayName} summary`}>
            <div className={s.highlightItem}>
              <span>Contacts</span>
              <strong>{account.linkedContactCount}</strong>
            </div>
            <div className={`${s.highlightItem} ${s.highlight_warning}`}>
              <span>Work Orders</span>
              <strong>{account.workOrderCount}</strong>
            </div>
            <div className={`${s.highlightItem} ${s.highlight_success}`}>
              <span>Estimates</span>
              <strong>{account.estimateCount}</strong>
            </div>
            <div className={s.highlightItem}>
              <span>People</span>
              <strong>{account.peopleCount || 0}</strong>
            </div>
          </div>
        </aside>

        <main className={s.contentSection}>
          <div className={s.contentTabs}>
            <button className={`${s.contentTab} ${activeTabValue === 'timeline' ? s.active : ''}`} onClick={() => setActiveTab('timeline')} type="button">Timeline</button>
            <button className={`${s.contentTab} ${activeTabValue === 'contacts' ? s.active : ''}`} onClick={() => setActiveTab('contacts')} type="button">Contacts ({(account.people?.length || 0) + (account.linkedContacts?.length || 0)})</button>
            <button className={`${s.contentTab} ${activeTabValue === 'workorders' ? s.active : ''}`} onClick={() => setActiveTab('workorders')} type="button">Work Orders ({account.workOrders?.length || 0})</button>
            <button className={`${s.contentTab} ${activeTabValue === 'estimates' ? s.active : ''}`} onClick={() => setActiveTab('estimates')} type="button">Estimates ({account.estimates?.length || 0})</button>
            <button className={`${s.contentTab} ${activeTabValue === 'source' ? s.active : ''}`} onClick={() => setActiveTab('source')} type="button">Source</button>
          </div>

          <div className={s.tabContent}>
            {activeTabValue === 'timeline' && (
              <>
                <div className={s.snapshotStrip} aria-label="Current client snapshot">
                  <button className={`${s.snapshotItem} ${s.snapshot_work}`} onClick={() => setActiveTab('workorders')} type="button">
                    <span className={s.snapshotIcon}><ClipboardList size={15} /></span>
                    <span className={s.snapshotCopy}><span>Work Orders</span><strong>{account.workOrderCount}</strong></span>
                    <small>{account.latestWorkOrderNumber || 'No work order yet'}</small>
                  </button>
                  <button className={`${s.snapshotItem} ${s.snapshot_estimate}`} onClick={() => setActiveTab('estimates')} type="button">
                    <span className={s.snapshotIcon}><BriefcaseBusiness size={15} /></span>
                    <span className={s.snapshotCopy}><span>Estimates</span><strong>{account.estimateCount}</strong></span>
                    <small>{account.latestEstimateNumber || 'No estimate yet'}</small>
                  </button>
                  <button className={`${s.snapshotItem} ${s.snapshot_lead}`} onClick={() => setActiveTab('contacts')} type="button">
                    <span className={s.snapshotIcon}><UserRound size={15} /></span>
                    <span className={s.snapshotCopy}><span>Contacts</span><strong>{account.linkedContactCount}</strong></span>
                    <small>{primaryMethodText || 'No contact method'}</small>
                  </button>
                  <button className={s.snapshotItem} onClick={() => setActiveTab('source')} type="button">
                    <span className={s.snapshotIcon}><Archive size={15} /></span>
                    <span className={s.snapshotCopy}><span>Source</span><strong>{account.provenanceAliases?.length || 0}</strong></span>
                    <small>Provenance aliases</small>
                  </button>
                </div>

                <div className={s.timeline}>
                  {timeline.map((item) => {
                    const Icon = item.icon;
                    const dateParts = timelineDateParts(item);
                    return (
                      <div key={item.id} className={`${s.timelineItem} ${item.toneClass || ''}`}>
                        <div className={s.timelineIcon}><Icon size={16} /></div>
                        <div className={s.timelineBody}>
                          <div className={s.timelineMeta}>
                            <div className={s.timelineTypeGroup}>
                              <span className={s.timelineType}>{item.type}</span>
                            </div>
                            <time className={s.timelineDateStack} dateTime={item.date || undefined}>
                              <span>{dateParts.date}</span>
                            </time>
                          </div>
                          <div className={s.timelineTitle}>
                            {item.href ? <Link href={item.href}>{item.title}</Link> : item.title}
                          </div>
                          {item.text && <div className={s.timelineText}>{item.text}</div>}
                        </div>
                      </div>
                    );
                  })}
                  {timeline.length === 0 && <EmptyState>No client activity recorded yet.</EmptyState>}
                </div>
              </>
            )}

            {activeTabValue === 'contacts' && (
              <div className={s.recordsList}>
                {!!account.people?.length && account.people.map((person) => (
                  <RecordCard
                    key={person.id}
                    icon={UserRound}
                    title={person.name}
                    subtitle={person.role || 'Contact person'}
                    badge={person.isPrimary ? 'Primary' : ''}
                  />
                ))}
                {!!account.linkedContacts?.length && account.linkedContacts.map((contact) => (
                  <RecordCard
                    key={contact.id}
                    icon={Link2}
                    title={contact.name}
                    subtitle={contactSummary(contact) || 'Linked source contact'}
                    href={`/contacts/${contact.id}`}
                  />
                ))}
                {!account.people?.length && !account.linkedContacts?.length && (
                  <EmptyState>No contacts linked to this client yet.</EmptyState>
                )}
                {!account.people?.length && !!account.linkedContacts?.length && (
                  <EmptyState>Named contact-person extraction is pending review; linked source contacts are shown above.</EmptyState>
                )}
              </div>
            )}

            {activeTabValue === 'workorders' && (
              <div className={s.recordsList}>
                {!!account.workOrders?.length ? account.workOrders.map((record) => (
                  <RecordCard
                    key={record.id}
                    icon={ClipboardList}
                    title={record.workOrderNumber || record.title || 'Work order'}
                    subtitle={[record.title, dateLabel(record.updatedAt || record.createdAt)].filter(Boolean).join(' · ')}
                    badge={record.status}
                  />
                )) : <EmptyState>No work orders linked.</EmptyState>}
              </div>
            )}

            {activeTabValue === 'estimates' && (
              <div className={s.recordsList}>
                {!!account.estimates?.length ? account.estimates.map((record) => (
                  <RecordCard
                    key={record.id}
                    icon={FileText}
                    title={record.estimateNumber || 'Estimate'}
                    subtitle={[money(record.total), dateLabel(record.updatedAt || record.createdAt)].filter(Boolean).join(' · ')}
                    badge={record.status}
                  />
                )) : <EmptyState>No estimates linked.</EmptyState>}
              </div>
            )}

            {activeTabValue === 'source' && (
              <div className={s.recordsList}>
                {!!account.visibleAliases?.length && (
                  <RecordCard
                    icon={Building2}
                    title="Visible aliases"
                    subtitle={account.visibleAliases.join(' · ')}
                  />
                )}
                {!!account.provenanceAliases?.length ? account.provenanceAliases.map((alias) => (
                  <RecordCard
                    key={alias.id}
                    icon={Archive}
                    title={alias.value}
                    subtitle={[alias.type, alias.sourceSheet, alias.sourceRow ? `row ${alias.sourceRow}` : ''].filter(Boolean).join(' · ')}
                  />
                )) : <EmptyState>No source provenance aliases yet.</EmptyState>}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
