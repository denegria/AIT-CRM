import { summarizeInboxConversations } from './service.js';

const FIXTURE_MESSAGES = [
  {
    id: 'fixture-msg-1',
    conversationId: 'fixture-conv-1',
    providerLabel: 'Meta',
    channel: 'whatsapp',
    channelLabel: 'WhatsApp',
    direction: 'inbound',
    directionLabel: 'Inbound',
    deliveryStatus: 'received',
    deliveryStatusLabel: 'Received',
    text: 'Need pricing for lobby signage at our Miami office.',
    timestamp: '2026-06-29T14:18:00.000Z',
    createdAt: '2026-06-29T14:18:00.000Z',
    identities: { participant: '15551230001', sender: '15551230001', recipient: 'ait-signs-main' },
    conversation: { id: 'fixture-conv-1', status: 'open', statusLabel: 'Open', lastMessageAt: '2026-06-29T14:18:00.000Z' },
    channelConfig: { id: 'fixture-channel-1', label: 'AIT Signs WhatsApp' },
    contact: { id: 'fixture-contact-1', name: 'Marina Perez', phone: '(555) 123-0001', email: 'marina@example.com' },
    lead: { id: 'fixture-lead-1', status: 'Qualified', sourceName: 'Website Form', sourceType: 'website', assignedUserId: 'fixture-user-2' },
    businessUnit: { id: 'bu-demo-signs', name: 'AIT Signs', label: 'Divisions', color: '#4a7aff' },
  },
  {
    id: 'fixture-msg-2',
    conversationId: 'fixture-conv-1',
    providerLabel: 'Meta',
    channel: 'whatsapp',
    channelLabel: 'WhatsApp',
    direction: 'outbound',
    directionLabel: 'Outbound',
    deliveryStatus: 'delivered',
    deliveryStatusLabel: 'Delivered',
    text: 'Happy to help. What size sign are you considering?',
    timestamp: '2026-06-29T13:40:00.000Z',
    createdAt: '2026-06-29T13:40:00.000Z',
    identities: { participant: '15551230001', sender: 'ait-signs-main', recipient: '15551230001' },
    conversation: { id: 'fixture-conv-1', status: 'open', statusLabel: 'Open', lastMessageAt: '2026-06-29T14:18:00.000Z' },
    channelConfig: { id: 'fixture-channel-1', label: 'AIT Signs WhatsApp' },
    contact: { id: 'fixture-contact-1', name: 'Marina Perez', phone: '(555) 123-0001', email: 'marina@example.com' },
    lead: { id: 'fixture-lead-1', status: 'Qualified', sourceName: 'Website Form', sourceType: 'website', assignedUserId: 'fixture-user-2' },
    businessUnit: { id: 'bu-demo-signs', name: 'AIT Signs', label: 'Divisions', color: '#4a7aff' },
  },
  {
    id: 'fixture-msg-3',
    conversationId: 'fixture-conv-2',
    providerLabel: 'Meta',
    channel: 'messenger',
    channelLabel: 'Messenger',
    direction: 'outbound',
    directionLabel: 'Outbound',
    deliveryStatus: 'failed',
    deliveryStatusLabel: 'Failed',
    text: 'Following up on the monument sign proof.',
    timestamp: '2026-06-29T12:04:00.000Z',
    createdAt: '2026-06-29T12:04:00.000Z',
    identities: { participant: 'fb-guest-204', sender: 'AIT Signs Facebook', recipient: 'fb-guest-204' },
    conversation: { id: 'fixture-conv-2', status: 'open', statusLabel: 'Open', lastMessageAt: '2026-06-29T12:04:00.000Z' },
    channelConfig: { id: 'fixture-channel-2', label: 'AIT Signs Facebook' },
    contact: { id: 'fixture-contact-2', name: 'Daniel Ortiz', phone: '(555) 123-0002', email: 'daniel@example.com' },
    lead: { id: 'fixture-lead-2', status: 'Proposal Sent', sourceName: 'Facebook Lead Ad', sourceType: 'meta_lead_ad', assignedUserId: 'fixture-user-1' },
    businessUnit: { id: 'bu-demo-signs', name: 'AIT Signs', label: 'Divisions', color: '#4a7aff' },
  },
  {
    id: 'fixture-msg-4',
    conversationId: 'fixture-conv-3',
    providerLabel: 'Meta',
    channel: 'messenger',
    channelLabel: 'Messenger',
    direction: 'inbound',
    directionLabel: 'Inbound',
    deliveryStatus: 'received',
    deliveryStatusLabel: 'Received',
    text: 'Can someone confirm my orientation paperwork?',
    timestamp: '2026-06-28T16:25:00.000Z',
    createdAt: '2026-06-28T16:25:00.000Z',
    identities: { participant: 'fb-student-88', sender: 'fb-student-88', recipient: 'AIT USA Institute' },
    conversation: { id: 'fixture-conv-3', status: 'open', statusLabel: 'Open', lastMessageAt: '2026-06-28T16:25:00.000Z' },
    channelConfig: { id: 'fixture-channel-3', label: 'AIT USA Messenger' },
    contact: { id: 'fixture-contact-3', name: 'Arianna Flores', phone: '(555) 123-0003', email: 'arianna@example.com' },
    lead: { id: 'fixture-lead-3', status: 'Enrolled', sourceName: 'Campus Tour', sourceType: 'manual', assignedUserId: 'fixture-user-3' },
    businessUnit: { id: 'bu-demo-institute', name: 'AIT USA Institute', label: 'Divisions', color: '#22c55e' },
  },
];

const FIXTURE_TASKS = [
  {
    id: 'fixture-task-1',
    contactId: 'fixture-contact-1',
    leadId: 'fixture-lead-1',
    title: 'Call back with signage dimensions',
    status: 'open',
    priority: 'high',
    dueAt: '2026-06-29T15:00:00.000Z',
    ownerUserId: 'fixture-user-1',
  },
  {
    id: 'fixture-task-2',
    contactId: 'fixture-contact-2',
    leadId: 'fixture-lead-2',
    title: 'Resolve Messenger delivery failure',
    status: 'in_progress',
    priority: 'urgent',
    dueAt: '2026-06-28T18:00:00.000Z',
    ownerUserId: 'fixture-user-2',
  },
];

const FIXTURE_USERS = [
  { id: 'fixture-user-1', name: 'Carlos Rivera', email: 'carlos@example.com' },
  { id: 'fixture-user-2', name: 'Dana Kim', email: 'dana@example.com' },
  { id: 'fixture-user-3', name: 'Marcus Hall', email: 'marcus@example.com' },
];

export function buildInboxFixtureData() {
  const conversations = summarizeInboxConversations(FIXTURE_MESSAGES, {
    tasks: FIXTURE_TASKS,
    users: FIXTURE_USERS,
  });

  return {
    conversations,
    threadsById: Object.fromEntries(conversations.map((conversation) => [
      conversation.id,
      FIXTURE_MESSAGES
        .filter((message) => message.conversationId === conversation.id)
        .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || ''))),
    ])),
  };
}
