'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Inbox,
  MessageCircle,
  RefreshCcw,
  UserRound,
} from 'lucide-react';
import { useCRM } from '@/lib/store';
import { buildInboxFixtureData } from '@/lib/conversations/inbox-fixtures.js';
import { inboxFixtureHint } from '@/lib/data.js';
import { matchesSearchValues } from '@/lib/search/match.js';
import s from './InboxPage.module.css';

const STATUS_FILTERS = [
  ['all', 'All statuses'],
  ['open', 'Open'],
  ['closed', 'Closed'],
  ['archived', 'Archived'],
];

const OWNER_FILTERS = [
  ['all', 'All owners'],
  ['assigned', 'Assigned'],
  ['unassigned', 'Unassigned'],
];

const ATTENTION_FILTERS = [
  ['all', 'All attention'],
  ['needs_reply', 'Needs reply'],
  ['overdue_task', 'Overdue task'],
  ['due_today', 'Due today'],
  ['delivery_issue', 'Delivery issue'],
  ['monitoring', 'Monitoring'],
  ['closed', 'Closed'],
  ['archived', 'Archived'],
];

function formatDateTime(value) {
  if (!value) return 'No activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No activity';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function messageIdentityLabel(message = {}) {
  if (message.direction === 'outbound') {
    return message.identities?.recipient ? `To ${message.identities.recipient}` : '';
  }
  return message.identities?.sender ? `From ${message.identities.sender}` : '';
}

function attentionBadgeClass(code = '') {
  if (code === 'delivery_issue' || code === 'overdue_task') return 'badge-overdue';
  if (code === 'needs_reply' || code === 'due_today') return 'badge-pending';
  if (code === 'closed' || code === 'archived') return 'badge-draft';
  return 'badge-contacted';
}

function statusBadgeClass(code = '') {
  if (code === 'closed' || code === 'archived') return 'badge-draft';
  return 'badge-contacted';
}

function threadEmptyText(mode) {
  if (mode === 'demo') return 'Demo thread data is unavailable.';
  return 'Select a conversation to inspect its thread.';
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const {
    access,
    accessibleBusinessUnits,
    canUseConsolidatedScope,
    currentBusinessUnit,
    currentBusinessUnitId,
    dataSource,
    loaded,
    scopeLabel,
  } = useCRM();
  const [conversations, setConversations] = useState([]);
  const [threadMessages, setThreadMessages] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState('');
  const [threadError, setThreadError] = useState('');
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [attentionFilter, setAttentionFilter] = useState('all');
  const [businessUnitFilter, setBusinessUnitFilter] = useState('all');

  const fixtureMode = searchParams.get('fixture') === 'demo' || dataSource !== 'postgres';
  const fixtureData = useMemo(() => buildInboxFixtureData(), []);
  const inboxConversations = fixtureMode ? fixtureData.conversations : conversations;
  const visibleError = fixtureMode ? '' : error;
  const visibleThreadError = fixtureMode ? '' : threadError;
  const businessUnitOptions = useMemo(() => {
    if (!fixtureMode) return accessibleBusinessUnits;

    const unitsById = new Map();
    fixtureData.conversations.forEach((conversation) => {
      if (conversation.businessUnit?.id) {
        unitsById.set(conversation.businessUnit.id, conversation.businessUnit);
      }
    });
    return [...unitsById.values()];
  }, [accessibleBusinessUnits, fixtureData.conversations, fixtureMode]);
  const activeBusinessUnitFilter = businessUnitFilter !== 'all'
    ? businessUnitFilter
    : fixtureMode || canUseConsolidatedScope
      ? 'all'
      : currentBusinessUnitId && currentBusinessUnitId !== 'all'
        ? currentBusinessUnitId
        : 'all';
  const channels = useMemo(() => [...new Set(inboxConversations.map((row) => row.channel).filter(Boolean))], [inboxConversations]);

  useEffect(() => {
    if (!loaded || !access.canReadCrm) return;

    if (fixtureMode) return;

    let cancelled = false;
    async function loadConversations() {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/conversations?limit=120&scanLimit=1200', { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load inbox conversations.');
        }
        if (!cancelled) {
          setConversations(payload.conversations || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load inbox conversations.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadConversations();

    return () => {
      cancelled = true;
    };
  }, [access.canReadCrm, fixtureMode, loaded]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return inboxConversations.filter((conversation) => {
      if (
        activeBusinessUnitFilter !== 'all' &&
        (conversation.businessUnit?.id || 'unassigned') !== activeBusinessUnitFilter
      ) return false;
      if (channelFilter !== 'all' && conversation.channel !== channelFilter) return false;
      if (statusFilter !== 'all' && conversation.status.code !== statusFilter) return false;
      if (ownerFilter === 'assigned' && conversation.owner.source === 'unassigned') return false;
      if (ownerFilter === 'unassigned' && conversation.owner.source !== 'unassigned') return false;
      if (attentionFilter !== 'all' && conversation.attention.code !== attentionFilter) return false;
      if (!query) return true;

      return matchesSearchValues(query, [
        conversation.identityLabel,
        conversation.contact?.name,
        conversation.contact?.email,
        conversation.contact?.phone,
        conversation.lead?.status,
        conversation.lastMessage.preview,
        conversation.owner.label,
        conversation.businessUnit?.name,
      ], [conversation.contact?.phone]);
    });
  }, [activeBusinessUnitFilter, attentionFilter, channelFilter, inboxConversations, ownerFilter, search, statusFilter]);

  const selectedConversation = useMemo(() => (
    filteredConversations.find((conversation) => conversation.id === selectedConversationId) || filteredConversations[0] || null
  ), [filteredConversations, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversation) {
      return;
    }

    if (fixtureMode) return;

    let cancelled = false;
    async function loadThreadMessages() {
      await Promise.resolve();
      if (cancelled) return;
      setThreadLoading(true);
      setThreadError('');
      try {
        const response = await fetch(`/api/conversations/${selectedConversation.id}?limit=150`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load conversation thread.');
        }
        if (!cancelled) {
          setThreadMessages(payload.messages || []);
        }
      } catch (err) {
        if (!cancelled) setThreadError(err.message || 'Unable to load conversation thread.');
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    }
    loadThreadMessages();

    return () => {
      cancelled = true;
    };
  }, [fixtureMode, selectedConversation]);

  const visibleThreadMessages = fixtureMode && selectedConversation
    ? fixtureData.threadsById[selectedConversation.id] || []
    : threadMessages;

  if (!loaded) return <div className="empty-state">Loading inbox…</div>;
  if (!access.canReadCrm) return <div className="empty-state">CRM read access is required to view the inbox.</div>;

  return (
    <div className={s.page}>
      <div className="page-header">
        <div>
          <h1>Inbox</h1>
          <p className="page-subtitle">
            View-only messaging scan across {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`} with derived owner and attention labels.
          </p>
        </div>
        <div className={s.headerActions}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (fixtureMode) {
                setError('');
                setThreadError('');
                return;
              }
              setLoading(true);
              setError('');
              fetch('/api/conversations?limit=120&scanLimit=1200', { cache: 'no-store' })
                .then(async (response) => {
                  const payload = await response.json().catch(() => ({}));
                  if (!response.ok) throw new Error(payload.error || 'Unable to refresh inbox.');
                  setConversations(payload.conversations || []);
                })
                .catch((err) => setError(err.message || 'Unable to refresh inbox.'))
                .finally(() => setLoading(false));
            }}
          >
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>
      </div>

      {fixtureMode && (
        <div className={s.fixtureBanner}>
          <AlertTriangle size={16} />
          <div>
            <strong>{inboxFixtureHint.label}</strong>
            <div>{inboxFixtureHint.description}</div>
          </div>
        </div>
      )}

      <div className={s.filters}>
        <label className={s.filterField}>
          <span>Search</span>
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search contact, lead, owner, or message"
          />
        </label>
        <label className={s.filterField}>
          <span>{scopeLabel}</span>
          <select className="input select" value={activeBusinessUnitFilter} onChange={(event) => setBusinessUnitFilter(event.target.value)}>
            {(canUseConsolidatedScope || fixtureMode) && <option value="all">All visible</option>}
            {businessUnitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
          </select>
        </label>
        <label className={s.filterField}>
          <span>Channel</span>
          <select className="input select" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
            <option value="all">All channels</option>
            {channels.map((channel) => (
              <option key={channel} value={channel}>
                {inboxConversations.find((row) => row.channel === channel)?.channelLabel || channel}
              </option>
            ))}
          </select>
        </label>
        <label className={s.filterField}>
          <span>Status</span>
          <select className="input select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={s.filterField}>
          <span>Owner</span>
          <select className="input select" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
            {OWNER_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={s.filterField}>
          <span>Attention</span>
          <select className="input select" value={attentionFilter} onChange={(event) => setAttentionFilter(event.target.value)}>
            {ATTENTION_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {(loading || visibleError) && (
        <div className={s.stateRow}>
          {loading && <span className="badge badge-pending">Loading</span>}
          {visibleError && <span className="badge badge-overdue">{visibleError}</span>}
        </div>
      )}

      <div className={s.workspace}>
        <section className={s.listPane}>
          <div className={s.listHeader}>
            <div className={s.listTitle}>
              <Inbox size={16} />
              <span>{filteredConversations.length} conversations</span>
            </div>
            <span className="badge badge-draft">{fixtureMode ? 'Fixture' : 'Live DB'}</span>
          </div>
          <div className={s.listBody}>
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`${s.rowCard} ${selectedConversation?.id === conversation.id ? s.rowCardActive : ''}`}
                onClick={() => setSelectedConversationId(conversation.id)}
              >
                <div className={s.rowTop}>
                  <div>
                    <div className={s.rowName}>{conversation.identityLabel}</div>
                    <div className={s.rowMeta}>
                      <span>{conversation.channelLabel}</span>
                      {conversation.businessUnit?.name && <span>{conversation.businessUnit.name}</span>}
                      {conversation.status.sourceLabel && <span>{conversation.status.sourceLabel}</span>}
                    </div>
                  </div>
                  <div className={s.rowTime}>{formatDateTime(conversation.lastMessage.timestamp)}</div>
                </div>
                <div className={s.rowPreview}>{conversation.lastMessage.preview}</div>
                <div className={s.rowBadges}>
                  <span className={`badge ${statusBadgeClass(conversation.status.code)}`}>{conversation.status.label}</span>
                  <span className={`badge ${attentionBadgeClass(conversation.attention.code)}`}>{conversation.attention.label}</span>
                  <span className="badge badge-draft">{conversation.owner.label}</span>
                </div>
              </button>
            ))}
            {!filteredConversations.length && (
              <div className="empty-state">
                <div className="empty-state-title">No conversations in this scope</div>
                <div className="empty-state-copy">
                  {fixtureMode
                    ? `Try ${inboxFixtureHint.query} on a different ${scopeLabel.toLowerCase()} or clear a filter.`
                    : 'The current database scope has no stored messaging threads yet.'}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className={s.threadPane}>
          {selectedConversation ? (
            <>
              <div className={s.threadHeader}>
                <div>
                  <div className={s.threadTitle}>{selectedConversation.identityLabel}</div>
                  <div className={s.threadMeta}>
                    <span>{selectedConversation.owner.label}</span>
                    <span>{selectedConversation.attention.reason}</span>
                  </div>
                </div>
                {selectedConversation.contact?.href && (
                  <Link className="btn btn-secondary btn-sm" href={selectedConversation.contact.href}>
                    <UserRound size={14} /> Open contact
                  </Link>
                )}
              </div>

              <div className={s.summaryGrid}>
                <div className={s.summaryCard}>
                  <div className={s.summaryLabel}>Status</div>
                  <div className={s.summaryValue}>{selectedConversation.status.label}</div>
                  <div className={s.summaryDetail}>{selectedConversation.thread.conversationStatusLabel || 'Open conversation state'}</div>
                </div>
                <div className={s.summaryCard}>
                  <div className={s.summaryLabel}>Attention</div>
                  <div className={s.summaryValue}>{selectedConversation.attention.label}</div>
                  <div className={s.summaryDetail}>{selectedConversation.attention.reason}</div>
                </div>
                <div className={s.summaryCard}>
                  <div className={s.summaryLabel}>Owner</div>
                  <div className={s.summaryValue}>{selectedConversation.owner.label}</div>
                  <div className={s.summaryDetail}>{selectedConversation.owner.reason}</div>
                </div>
                <div className={s.summaryCard}>
                  <div className={s.summaryLabel}>Last source</div>
                  <div className={s.summaryValue}>{selectedConversation.lastMessage.sourceLabel}</div>
                  <div className={s.summaryDetail}>{selectedConversation.thread.messageCount} messages in this thread</div>
                </div>
              </div>

              {threadLoading && <div className={s.stateRow}><span className="badge badge-pending">Loading thread</span></div>}
              {visibleThreadError && <div className={s.stateRow}><span className="badge badge-overdue">{visibleThreadError}</span></div>}

              <div className={s.threadList}>
                {visibleThreadMessages.map((message) => (
                  <div key={message.id} className={`${s.messageCard} ${message.direction === 'outbound' ? s.outbound : s.inbound}`}>
                    <div className={s.messageHead}>
                      <div className={s.messageBadges}>
                        <span className="badge badge-draft">{message.providerLabel}</span>
                        <span className="badge badge-draft">{message.channelLabel}</span>
                        <span className={`badge ${message.direction === 'outbound' ? 'badge-contacted' : 'badge-pending'}`}>{message.directionLabel}</span>
                        <span className={`badge ${message.deliveryStatus === 'failed' ? 'badge-overdue' : 'badge-draft'}`}>{message.deliveryStatusLabel}</span>
                      </div>
                      <span className={s.messageTime}>{formatDateTime(message.timestamp || message.createdAt)}</span>
                    </div>
                    <div className={s.messageBody}>{message.text || 'No message body captured.'}</div>
                    <div className={s.messageMeta}>
                      <span>{message.channelConfig?.label || `${message.providerLabel} ${message.channelLabel}`}</span>
                      {messageIdentityLabel(message) && <span>{messageIdentityLabel(message)}</span>}
                      {message.businessUnit?.name && <span>{message.businessUnit.name}</span>}
                      {message.lead?.status && <span>Lead: {message.lead.status}</span>}
                    </div>
                  </div>
                ))}
                {!visibleThreadMessages.length && !threadLoading && (
                  <div className="empty-state">
                    <MessageCircle size={18} />
                    <div className="empty-state-title">No thread messages</div>
                    <div className="empty-state-copy">{threadEmptyText(fixtureMode ? 'demo' : 'live')}</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Inbox size={18} />
              <div className="empty-state-title">No thread selected</div>
              <div className="empty-state-copy">Choose a conversation from the inbox list to inspect its thread.</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
