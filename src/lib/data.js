const today = new Date();
const d = (offset) => {
  const dt = new Date(today);
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

export const STATUSES = {
  lead: [
    'New Lead',
    'Intake',
    'Follow Up',
    'Enrolled',
    'Dropped / Quit',
    'Retargeting',
    'Not Interested',
    'Course Completed',
    'Estimate',
    'Work Order',
    'Fulfillment',
    'Invoice / Payment',
    'Contacted',
    'Qualified',
    'Proposal Sent',
    'Won',
    'Lost',
  ],
  workOrder: ['Pending', 'In Progress', 'Completed', 'On Hold'],
  financial: ['Draft', 'Pending', 'Paid', 'Overdue'],
  priority: ['Low', 'Medium', 'High'],
};

export const SOURCES = ['Facebook Ads', 'Website', 'Referral', 'Cold Call', 'Google Ads'];

export const EMPLOYEES = [
  { id: 'emp-1', name: 'Carlos Rivera', roleKeys: ['admin'] },
  { id: 'emp-2', name: 'Dana Kim', roleKeys: ['account_manager'] },
  { id: 'emp-3', name: 'Marcus Hall', roleKeys: ['designer'] },
  { id: 'emp-4', name: 'Sofia Ramirez', roleKeys: ['account_manager'] },
  { id: 'emp-5', name: 'Mateo Cruz', roleKeys: ['account_manager'] },
];

export const businessUnits = [
  { id: 'bu-demo-signs', name: 'AIT Signs', label: 'Divisions', color: '#4a7aff', isActive: true },
  { id: 'bu-demo-institute', name: 'AIT USA Institute', label: 'Divisions', color: '#22c55e', isActive: true },
  { id: 'bu-demo-photo-video', name: 'AIT Photo & Video', label: 'Divisions', color: '#a78bfa', isActive: true },
  { id: 'bu-demo-taxes', name: 'AIT Taxes', label: 'Divisions', color: '#ef4444', isActive: true },
];

export const contacts = [
  {
    id: 'c-1',
    name: 'Sample Signs Intake',
    email: 'lead@example.com',
    phone: '(555) 010-1000',
    status: 'Intake',
    source: 'Facebook Ads',
    businessUnitId: 'bu-demo-signs',
    primaryBusinessUnitId: 'bu-demo-signs',
    assignedTo: 'emp-1',
    lastContact: d(-1),
    lastTouch: d(-1),
    lastEdited: d(-1),
    latestComment: 'Demo intake row awaiting import staging review.',
    notes: [{ text: 'Demo intake row awaiting import staging review.', date: d(-1) }],
  },
  {
    id: 'c-2',
    name: 'Sample Estimate Customer',
    email: 'estimate@example.com',
    phone: '(555) 010-2000',
    status: 'Proposal Sent',
    source: 'Website',
    businessUnitId: 'bu-demo-signs',
    primaryBusinessUnitId: 'bu-demo-signs',
    assignedTo: 'emp-2',
    lastContact: d(-3),
    lastTouch: d(-3),
    lastEdited: d(-2),
    latestComment: 'Demo estimate record used only when no database is configured.',
    notes: [{ text: 'Demo estimate record used only when no database is configured.', date: d(-3) }],
  },
  {
    id: 'c-3',
    name: 'Sample Work Order Customer',
    email: 'workorder@example.com',
    phone: '(555) 010-3000',
    status: 'Won',
    source: 'Referral',
    businessUnitId: 'bu-demo-signs',
    primaryBusinessUnitId: 'bu-demo-signs',
    assignedTo: 'emp-3',
    lastContact: d(-5),
    lastTouch: d(-5),
    lastEdited: d(-4),
    latestComment: 'Demo work order record for local UI fallback.',
    notes: [{ text: 'Demo work order record for local UI fallback.', date: d(-5) }],
  },
];

export const workOrders = [
  {
    id: 'wo-1',
    number: 'WO-DEMO-001',
    title: 'Demo Channel Letter Sign',
    client: 'Sample Work Order Customer',
    contactId: 'c-3',
    businessUnitId: 'bu-demo-signs',
    priority: 'High',
    status: 'In Progress',
    assignedTo: 'emp-3',
    dueDate: d(5),
    description: 'Local fallback record. Real AIT rows load through import staging.',
    estimatedCost: 4200,
  },
];

export const financials = [
  {
    id: 'f-1',
    number: 'EST-DEMO-001',
    type: 'Estimate',
    client: 'Sample Estimate Customer',
    contactId: 'c-2',
    businessUnitId: 'bu-demo-signs',
    amount: 1800,
    date: d(-3),
    dueDate: d(7),
    status: 'Pending',
    items: [{ desc: 'Demo sign estimate', qty: 1, rate: 1800 }],
  },
];

export const tasks = [
  {
    id: 't-1',
    title: 'Run AIT Signs import staging review',
    businessUnitId: 'bu-demo-signs',
    assignedTo: 'emp-1',
    ownerUserId: 'emp-1',
    dueDate: d(1),
    dueAt: `${d(1)}T10:30:00.000Z`,
    completed: false,
    priority: 'High',
    taskStatus: 'open',
    status: 'open',
    sourceLabel: 'Lead intake',
    updatedAt: `${d(0)}T13:30:00.000Z`,
  },
  {
    id: 't-2',
    title: 'Call back Acme lead',
    businessUnitId: 'bu-demo-signs',
    assignedTo: 'emp-2',
    ownerUserId: 'emp-2',
    dueDate: d(0),
    dueAt: `${d(0)}T10:30:00.000Z`,
    completed: false,
    priority: 'Medium',
    taskStatus: 'open',
    status: 'open',
    sourceLabel: 'Website leads',
    updatedAt: `${d(0)}T12:30:00.000Z`,
  },
  {
    id: 't-3',
    title: 'Upload site photos',
    businessUnitId: 'bu-demo-signs',
    assignedTo: 'emp-3',
    ownerUserId: 'emp-3',
    dueDate: d(0),
    dueAt: `${d(0)}T11:15:00.000Z`,
    completed: true,
    completedAt: `${d(0)}T11:00:00.000Z`,
    priority: 'Low',
    taskStatus: 'completed',
    status: 'completed',
    sourceLabel: 'Ops',
    updatedAt: `${d(0)}T11:00:00.000Z`,
  },
  {
    id: 't-4',
    title: 'Permit follow-up',
    businessUnitId: 'bu-demo-signs',
    assignedTo: 'emp-5',
    ownerUserId: 'emp-5',
    dueDate: d(-1),
    dueAt: `${d(-1)}T15:00:00.000Z`,
    completed: false,
    priority: 'High',
    taskStatus: 'open',
    status: 'open',
    sourceLabel: 'Work order',
    updatedAt: `${d(-1)}T18:00:00.000Z`,
  },
  {
    id: 't-5',
    title: 'Unassigned Facebook lead follow-up',
    businessUnitId: 'bu-demo-institute',
    assignedTo: '',
    ownerUserId: '',
    dueDate: d(0),
    dueAt: `${d(0)}T14:00:00.000Z`,
    completed: false,
    priority: 'High',
    taskType: 'follow_up',
    taskStatus: 'open',
    status: 'open',
    sourceType: 'automation',
    sourceLabel: 'New lead follow-up',
    sourceId: 'facebook_lead_ads:demo',
    updatedAt: `${d(0)}T09:30:00.000Z`,
  },
];

export const calendarEvents = [
  { id: 'ev-1', title: 'Import review checkpoint', date: d(1), type: 'meeting', contactId: 'c-1' },
  { id: 'ev-2', title: 'Acme callback', date: d(0), type: 'call', contactId: 'c-2' },
  { id: 'ev-3', title: 'Route review', date: d(0), type: 'meeting', contactId: 'c-3' },
];

export const salesLedger = [
  {
    id: 'sl-1',
    contactId: 'c-1',
    date: d(-1),
    note: 'Demo activity. Real customer history stays in staging until reviewed.',
    stage: 'Intake',
  },
];
