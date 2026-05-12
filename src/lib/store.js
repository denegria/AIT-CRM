'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as defaults from './data';

const CRMContext = createContext(null);
const STORAGE_KEY = 'ait-crm-data';

function loadStorage() {
  if (typeof window === 'undefined') return null;
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function saveStorage(d) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {}
}

function getInitialData(seedData = defaults) {
  const s = loadStorage();
  const fallback = seedData || defaults;
  const useLocalStorage = fallback.dataSource !== 'postgres';
  return {
    dataSource: fallback.dataSource || 'local',
    importStaging: fallback.importStaging || null,
    businessUnits: (useLocalStorage && s?.businessUnits) || fallback.businessUnits || [],
    contacts: (useLocalStorage && s?.contacts) || fallback.contacts,
    workOrders: (useLocalStorage && s?.workOrders) || fallback.workOrders,
    financials: (useLocalStorage && s?.financials) || fallback.financials,
    tasks: (useLocalStorage && s?.tasks) || fallback.tasks,
    calendarEvents: (useLocalStorage && s?.calendarEvents) || fallback.calendarEvents,
    salesLedger: (useLocalStorage && s?.salesLedger) || fallback.salesLedger,
  };
}

export function CRMProvider({ children, initialData }) {
  const [role, setRole] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ait-crm-role');
      return saved || 'admin';
    }
    return 'admin';
  });
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ait-crm-theme');
      return saved || 'light';
    }
    return 'light';
  });
  const [bootstrapData] = useState(() => getInitialData(initialData));
  const [importStaging] = useState(bootstrapData.importStaging);
  const [businessUnits, setBusinessUnits] = useState(bootstrapData.businessUnits);
  const [contacts, setContacts] = useState(bootstrapData.contacts);
  const [workOrders, setWorkOrders] = useState(bootstrapData.workOrders);
  const [financials, setFinancials] = useState(bootstrapData.financials);
  const [tasks, setTasks] = useState(bootstrapData.tasks);
  const [calendarEvents, setCalendarEvents] = useState(bootstrapData.calendarEvents);
  const [salesLedger, setSalesLedger] = useState(bootstrapData.salesLedger);
  const loaded = true;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ait-crm-role', role);
    }
  }, [role]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ait-crm-theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!loaded) return;
    saveStorage({ businessUnits, contacts, workOrders, financials, tasks, calendarEvents, salesLedger });
  }, [businessUnits, contacts, workOrders, financials, tasks, calendarEvents, salesLedger, loaded]);

  const gid = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

  const updateContact = useCallback((id, u) => setContacts(p => p.map(c => c.id===id ? {...c,...u} : c)), []);
  const addContact = useCallback((d) => setContacts(p => [{id:gid('c'),...d},...p]), []);
  const deleteContact = useCallback((id) => setContacts(p => p.filter(c => c.id!==id)), []);

  const updateWorkOrder = useCallback((id, u) => setWorkOrders(p => p.map(w => w.id===id ? {...w,...u} : w)), []);
  const addWorkOrder = useCallback((d) => setWorkOrders(p => [{id:gid('wo'),...d},...p]), []);
  const deleteWorkOrder = useCallback((id) => setWorkOrders(p => p.filter(w => w.id!==id)), []);

  const updateFinancial = useCallback((id, u) => setFinancials(p => p.map(f => f.id===id ? {...f,...u} : f)), []);
  const addFinancial = useCallback((d) => setFinancials(p => [{id:gid('f'),...d},...p]), []);
  const deleteFinancial = useCallback((id) => setFinancials(p => p.filter(f => f.id!==id)), []);

  const updateTask = useCallback((id, u) => setTasks(p => p.map(t => t.id===id ? {...t,...u} : t)), []);
  const addTask = useCallback((d) => setTasks(p => [{id:gid('t'),...d},...p]), []);
  const deleteTask = useCallback((id) => setTasks(p => p.filter(t => t.id!==id)), []);

  const addCalendarEvent = useCallback((d) => setCalendarEvents(p => [...p, {id:gid('ev'),...d}]), []);
  const deleteCalendarEvent = useCallback((id) => setCalendarEvents(p => p.filter(e => e.id!==id)), []);
  const addSalesEntry = useCallback((d) => setSalesLedger(p => [{id:gid('sl'),...d},...p]), []);

  const resetData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setBusinessUnits(defaults.businessUnits || []);
    setContacts(defaults.contacts); setWorkOrders(defaults.workOrders);
    setFinancials(defaults.financials); setTasks(defaults.tasks);
    setCalendarEvents(defaults.calendarEvents); setSalesLedger(defaults.salesLedger);
  }, []);

  const value = {
    role, setRole, theme, setTheme, loaded,
    dataSource: bootstrapData.dataSource,
    importStaging,
    businessUnits, setBusinessUnits,
    contacts, addContact, updateContact, deleteContact,
    workOrders, addWorkOrder, updateWorkOrder, deleteWorkOrder,
    financials, addFinancial, updateFinancial, deleteFinancial,
    tasks, addTask, updateTask, deleteTask,
    calendarEvents, addCalendarEvent, deleteCalendarEvent,
    salesLedger, addSalesEntry,
    employees: defaults.EMPLOYEES, statuses: defaults.STATUSES, sources: defaults.SOURCES,
    resetData,
  };
  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}

export function useCRM() {
  const c = useContext(CRMContext);
  if (!c) throw new Error('useCRM must be used within CRMProvider');
  return c;
}
