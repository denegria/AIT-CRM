// AIT CRM — Mock Data
// All dates relative to "today" for demo freshness

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

export const contacts = [
  { id: 'c-1', name: 'Marcus Thompson', email: 'marcus.t@email.com', phone: '(555) 234-8901', status: 'New Lead', source: 'Facebook Ads', assignedTo: 'emp-1', lastContact: d(-1), notes: 'Interested in full HVAC system for new build.' },
  { id: 'c-2', name: 'Sarah Chen', email: 'schen@chenoffice.com', phone: '(555) 345-1234', status: 'Contacted', source: 'Website', assignedTo: 'emp-2', lastContact: d(-3), notes: 'Office complex, needs duct cleaning quote.' },
  { id: 'c-3', name: 'David Rodriguez', email: 'drodriguez@gmail.com', phone: '(555) 456-7890', status: 'Qualified', source: 'Referral', assignedTo: 'emp-1', lastContact: d(-2), notes: 'Referred by Mitchell. AC issues.' },
  { id: 'c-4', name: 'Emily Watson', email: 'ewatson@watsonbldg.com', phone: '(555) 567-2345', status: 'Proposal Sent', source: 'Facebook Ads', assignedTo: 'emp-3', lastContact: d(-5), notes: 'Sent furnace replacement estimate. Awaiting approval.' },
  { id: 'c-5', name: 'James Mitchell', email: 'jmitchell@mitchellplaza.com', phone: '(555) 678-3456', status: 'Won', source: 'Cold Call', assignedTo: 'emp-1', lastContact: d(-7), notes: 'Signed maintenance contract. Quarterly service.' },
  { id: 'c-6', name: 'Lisa Park', email: 'lisa.park@email.com', phone: '(555) 789-4567', status: 'New Lead', source: 'Facebook Ads', assignedTo: 'emp-2', lastContact: d(0), notes: 'Inquired about smart thermostat install.' },
  { id: 'c-7', name: 'Robert Johnson', email: 'rjohnson@jwarehouse.com', phone: '(555) 890-5678', status: 'Contacted', source: 'Website', assignedTo: 'emp-3', lastContact: d(-4), notes: 'Warehouse heating system. Large commercial job.' },
  { id: 'c-8', name: 'Amanda Foster', email: 'afoster@fosterco.com', phone: '(555) 901-6789', status: 'Lost', source: 'Referral', assignedTo: 'emp-1', lastContact: d(-14), notes: 'Went with competitor. Price sensitive.' },
  { id: 'c-9', name: 'Michael Brown', email: 'mbrown@email.com', phone: '(555) 012-7890', status: 'Qualified', source: 'Facebook Ads', assignedTo: 'emp-2', lastContact: d(-1), notes: 'Residential AC replacement. 3-ton unit.' },
  { id: 'c-10', name: 'Jennifer Davis', email: 'jdavis@email.com', phone: '(555) 123-8901', status: 'New Lead', source: 'Google Ads', assignedTo: 'emp-3', lastContact: d(0), notes: 'Emergency heat repair inquiry.' },
  { id: 'c-11', name: 'Christopher Lee', email: 'clee@leegroup.com', phone: '(555) 234-9012', status: 'Won', source: 'Referral', assignedTo: 'emp-1', lastContact: d(-10), notes: 'Completed install. Happy customer.' },
  { id: 'c-12', name: 'Nicole Martinez', email: 'nmartinez@email.com', phone: '(555) 345-0123', status: 'Proposal Sent', source: 'Cold Call', assignedTo: 'emp-2', lastContact: d(-6), notes: 'Multi-unit property. Waiting on board approval.' },
  { id: 'c-13', name: 'Andrew Wilson', email: 'awilson@email.com', phone: '(555) 456-1234', status: 'Contacted', source: 'Facebook Ads', assignedTo: 'emp-3', lastContact: d(-2), notes: 'Scheduled site visit for next week.' },
  { id: 'c-14', name: 'Stephanie Taylor', email: 'staylor@email.com', phone: '(555) 567-2345', status: 'New Lead', source: 'Website', assignedTo: 'emp-1', lastContact: d(0), notes: 'Form submission — mini-split inquiry.' },
  { id: 'c-15', name: 'Kevin Anderson', email: 'kanderson@andersonhvac.com', phone: '(555) 678-3456', status: 'Qualified', source: 'Referral', assignedTo: 'emp-2', lastContact: d(-3), notes: 'Subcontractor opportunity. Large project.' },
];

export const workOrders = [
  { id: 'wo-1', number: 'WO-001', title: 'HVAC Installation', client: 'Marcus Thompson', contactId: 'c-1', priority: 'High', status: 'Pending', assignedTo: 'emp-1', dueDate: d(3), description: 'Full residential HVAC system install — 4-ton split system.', estimatedCost: 4500 },
  { id: 'wo-2', number: 'WO-002', title: 'Duct Cleaning', client: 'Sarah Chen', contactId: 'c-2', priority: 'Medium', status: 'In Progress', assignedTo: 'emp-2', dueDate: d(1), description: 'Commercial duct cleaning for 3-story office complex.', estimatedCost: 3200 },
  { id: 'wo-3', number: 'WO-003', title: 'AC Repair', client: 'David Rodriguez', contactId: 'c-3', priority: 'High', status: 'In Progress', assignedTo: 'emp-1', dueDate: d(0), description: 'Diagnose and repair faulty compressor. Refrigerant recharge.', estimatedCost: 1800 },
  { id: 'wo-4', number: 'WO-004', title: 'Furnace Replacement', client: 'Emily Watson', contactId: 'c-4', priority: 'Medium', status: 'Pending', assignedTo: 'emp-3', dueDate: d(7), description: 'Remove old gas furnace, install high-efficiency model.', estimatedCost: 7800 },
  { id: 'wo-5', number: 'WO-005', title: 'Preventive Maintenance', client: 'James Mitchell', contactId: 'c-5', priority: 'Low', status: 'Completed', assignedTo: 'emp-1', dueDate: d(-3), description: 'Quarterly maintenance — filters, coils, calibration.', estimatedCost: 450 },
  { id: 'wo-6', number: 'WO-006', title: 'Thermostat Upgrade', client: 'Lisa Park', contactId: 'c-6', priority: 'Low', status: 'Pending', assignedTo: 'emp-2', dueDate: d(5), description: 'Install Nest smart thermostat, configure zones.', estimatedCost: 680 },
  { id: 'wo-7', number: 'WO-007', title: 'Emergency Repair', client: 'Robert Johnson', contactId: 'c-7', priority: 'High', status: 'In Progress', assignedTo: 'emp-3', dueDate: d(0), description: 'Warehouse heater failure. Emergency call-out.', estimatedCost: 2400 },
  { id: 'wo-8', number: 'WO-008', title: 'System Inspection', client: 'Amanda Foster', contactId: 'c-8', priority: 'Low', status: 'On Hold', assignedTo: 'emp-1', dueDate: d(10), description: 'Pre-sale inspection report for commercial property.', estimatedCost: 350 },
];

export const financials = [
  { id: 'f-1', number: 'EST-001', type: 'Estimate', client: 'Marcus Thompson', contactId: 'c-1', amount: 4500, date: d(-5), dueDate: d(10), status: 'Pending', items: [{ desc: 'HVAC System (4-ton)', qty: 1, rate: 3200 }, { desc: 'Installation Labor', qty: 1, rate: 1300 }] },
  { id: 'f-2', number: 'INV-001', type: 'Invoice', client: 'Sarah Chen', contactId: 'c-2', amount: 3200, date: d(-20), dueDate: d(-5), status: 'Paid', paidDate: d(-6), items: [{ desc: 'Duct Cleaning — 3 floors', qty: 3, rate: 900 }, { desc: 'Sanitization Treatment', qty: 1, rate: 500 }] },
  { id: 'f-3', number: 'INV-002', type: 'Invoice', client: 'David Rodriguez', contactId: 'c-3', amount: 1800, date: d(-10), dueDate: d(0), status: 'Pending', items: [{ desc: 'Compressor Diagnosis', qty: 1, rate: 250 }, { desc: 'Compressor Replacement', qty: 1, rate: 1200 }, { desc: 'Refrigerant Recharge', qty: 1, rate: 350 }] },
  { id: 'f-4', number: 'EST-002', type: 'Estimate', client: 'Emily Watson', contactId: 'c-4', amount: 7800, date: d(-8), dueDate: d(14), status: 'Draft', items: [{ desc: 'High-Efficiency Furnace', qty: 1, rate: 5200 }, { desc: 'Removal & Disposal', qty: 1, rate: 600 }, { desc: 'Installation & Ductwork', qty: 1, rate: 2000 }] },
  { id: 'f-5', number: 'INV-003', type: 'Invoice', client: 'James Mitchell', contactId: 'c-5', amount: 450, date: d(-30), dueDate: d(-15), status: 'Paid', paidDate: d(-16), items: [{ desc: 'Quarterly Maintenance', qty: 1, rate: 450 }] },
  { id: 'f-6', number: 'REC-001', type: 'Receipt', client: 'Sarah Chen', contactId: 'c-2', amount: 3200, date: d(-6), status: 'Paid', refInvoice: 'INV-001', items: [{ desc: 'Payment for INV-001', qty: 1, rate: 3200 }] },
  { id: 'f-7', number: 'INV-004', type: 'Invoice', client: 'Robert Johnson', contactId: 'c-7', amount: 2400, date: d(-15), dueDate: d(-2), status: 'Overdue', items: [{ desc: 'Emergency Heater Repair', qty: 1, rate: 1800 }, { desc: 'Parts & Materials', qty: 1, rate: 600 }] },
  { id: 'f-8', number: 'EST-003', type: 'Estimate', client: 'Robert Johnson', contactId: 'c-7', amount: 8900, date: d(-12), dueDate: d(7), status: 'Pending', items: [{ desc: 'Full System Replacement', qty: 1, rate: 7200 }, { desc: 'Ductwork Modification', qty: 1, rate: 1700 }] },
  { id: 'f-9', number: 'INV-005', type: 'Invoice', client: 'Christopher Lee', contactId: 'c-11', amount: 6200, date: d(-25), dueDate: d(-10), status: 'Paid', paidDate: d(-11), items: [{ desc: 'Central AC Install', qty: 1, rate: 5200 }, { desc: 'Thermostat & Controls', qty: 1, rate: 1000 }] },
  { id: 'f-10', number: 'REC-002', type: 'Receipt', client: 'James Mitchell', contactId: 'c-5', amount: 450, date: d(-16), status: 'Paid', refInvoice: 'INV-003', items: [{ desc: 'Payment for INV-003', qty: 1, rate: 450 }] },
  { id: 'f-11', number: 'REC-003', type: 'Receipt', client: 'Christopher Lee', contactId: 'c-11', amount: 6200, date: d(-11), status: 'Paid', refInvoice: 'INV-005', items: [{ desc: 'Payment for INV-005', qty: 1, rate: 6200 }] },
  { id: 'f-12', number: 'INV-006', type: 'Invoice', client: 'Nicole Martinez', contactId: 'c-12', amount: 4100, date: d(-7), dueDate: d(7), status: 'Pending', items: [{ desc: 'Multi-Unit HVAC Assessment', qty: 4, rate: 800 }, { desc: 'Report & Recommendations', qty: 1, rate: 900 }] },
  { id: 'f-13', number: 'EST-004', type: 'Estimate', client: 'Kevin Anderson', contactId: 'c-15', amount: 15200, date: d(-3), dueDate: d(21), status: 'Pending', items: [{ desc: 'Commercial Rooftop Unit', qty: 2, rate: 6100 }, { desc: 'Crane & Rigging', qty: 1, rate: 3000 }] },
];

export const tasks = [
  { id: 't-1', title: 'Follow up with Marcus Thompson', assignedTo: 'emp-1', dueDate: d(0), completed: false, priority: 'High' },
  { id: 't-2', title: 'Send estimate to Emily Watson', assignedTo: 'emp-3', dueDate: d(1), completed: false, priority: 'Medium' },
  { id: 't-3', title: 'Schedule inspection — Mitchell Plaza', assignedTo: 'emp-1', dueDate: d(2), completed: false, priority: 'Low' },
  { id: 't-4', title: 'Call Jennifer Davis re: inquiry', assignedTo: 'emp-3', dueDate: d(0), completed: false, priority: 'High' },
  { id: 't-5', title: 'Prepare monthly revenue report', assignedTo: 'emp-2', dueDate: d(3), completed: false, priority: 'Medium' },
  { id: 't-6', title: 'Order parts — Johnson emergency', assignedTo: 'emp-3', dueDate: d(0), completed: true, priority: 'High' },
  { id: 't-7', title: 'Update CRM with new lead info', assignedTo: 'emp-2', dueDate: d(1), completed: false, priority: 'Low' },
  { id: 't-8', title: 'Review pending invoices', assignedTo: 'emp-1', dueDate: d(2), completed: false, priority: 'Medium' },
];

export const calendarEvents = [
  { id: 'ev-1', title: 'Site Visit — Thompson', date: d(1), type: 'visit', contactId: 'c-1' },
  { id: 'ev-2', title: 'Team Standup', date: d(0), type: 'meeting' },
  { id: 'ev-3', title: 'Follow-up Call — Chen', date: d(2), type: 'call', contactId: 'c-2' },
  { id: 'ev-4', title: 'Install @ Rodriguez', date: d(3), type: 'job', contactId: 'c-3' },
  { id: 'ev-5', title: 'Monthly Review', date: d(5), type: 'meeting' },
  { id: 'ev-6', title: 'Estimate Deadline — Watson', date: d(7), type: 'deadline', contactId: 'c-4' },
  { id: 'ev-7', title: 'Maintenance — Mitchell', date: d(10), type: 'job', contactId: 'c-5' },
  { id: 'ev-8', title: 'Follow-up — Martinez', date: d(4), type: 'call', contactId: 'c-12' },
  { id: 'ev-9', title: 'Emergency Repair — Johnson', date: d(0), type: 'job', contactId: 'c-7' },
  { id: 'ev-10', title: 'Thermostat Install — Park', date: d(5), type: 'job', contactId: 'c-6' },
];

export const salesLedger = [
  { id: 'sl-1', contactId: 'c-1', date: d(-1), note: 'Initial call. Very interested. Wants quote ASAP.', stage: 'New Lead' },
  { id: 'sl-2', contactId: 'c-2', date: d(-3), note: 'Sent info packet. Will call back Thursday.', stage: 'Contacted' },
  { id: 'sl-3', contactId: 'c-4', date: d(-5), note: 'Proposal sent via email. Board meets next week.', stage: 'Proposal Sent' },
  { id: 'sl-4', contactId: 'c-5', date: d(-7), note: 'Signed annual maintenance contract. $450/quarter.', stage: 'Won' },
  { id: 'sl-5', contactId: 'c-8', date: d(-14), note: 'Lost to competitor. Price was 15% lower.', stage: 'Lost' },
  { id: 'sl-6', contactId: 'c-9', date: d(-1), note: 'Qualified. Needs 3-ton replacement. Scheduling site visit.', stage: 'Qualified' },
  { id: 'sl-7', contactId: 'c-13', date: d(-2), note: 'Good conversation. Interested in energy-efficient options.', stage: 'Contacted' },
];
