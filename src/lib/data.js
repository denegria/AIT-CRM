const today = new Date();
const d = (offset) => {
  const dt = new Date(today);
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};

export const STATUSES = {
  lead: ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'],
  workOrder: ['Pending', 'In Progress', 'Completed', 'On Hold'],
  financial: ['Draft', 'Pending', 'Paid', 'Overdue'],
  priority: ['Low', 'Medium', 'High'],
};

export const SOURCES = ['Facebook Ads', 'Website', 'Referral', 'Cold Call', 'Google Ads'];

export const EMPLOYEES = [
  { id: 'emp-1', name: 'Carlos Rivera' },
  { id: 'emp-2', name: 'Dana Kim' },
  { id: 'emp-3', name: 'Marcus Hall' },
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
    name: 'Sample Signs Lead',
    email: 'lead@example.com',
    phone: '(555) 010-1000',
    status: 'New Lead',
    source: 'Facebook Ads',
    assignedTo: 'emp-1',
    lastContact: d(-1),
    notes: [{ text: 'Demo lead awaiting import staging review.', date: d(-1) }],
  },
  {
    id: 'c-2',
    name: 'Sample Estimate Customer',
    email: 'estimate@example.com',
    phone: '(555) 010-2000',
    status: 'Proposal Sent',
    source: 'Website',
    assignedTo: 'emp-2',
    lastContact: d(-3),
    notes: [{ text: 'Demo estimate record used only when no database is configured.', date: d(-3) }],
  },
  {
    id: 'c-3',
    name: 'Sample Work Order Customer',
    email: 'workorder@example.com',
    phone: '(555) 010-3000',
    status: 'Won',
    source: 'Referral',
    assignedTo: 'emp-3',
    lastContact: d(-5),
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
    assignedTo: 'emp-1',
    dueDate: d(1),
    completed: false,
    priority: 'High',
  },
];

export const calendarEvents = [
  { id: 'ev-1', title: 'Import review checkpoint', date: d(1), type: 'meeting', contactId: 'c-1' },
];

export const salesLedger = [
  {
    id: 'sl-1',
    contactId: 'c-1',
    date: d(-1),
    note: 'Demo activity. Real customer history stays in staging until reviewed.',
    stage: 'New Lead',
  },
];
