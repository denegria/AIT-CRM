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
  const fallback = seedData || defaults;
  return {
    dataSource: fallback.dataSource || 'local',
    authRequired: fallback.authRequired || false,
    authError: fallback.authError || '',
    currentUser: fallback.currentUser || null,
    access: fallback.access || {},
    importStaging: fallback.importStaging || null,
    businessUnits: fallback.businessUnits || [],
    contacts: fallback.contacts,
    workOrders: fallback.workOrders,
    financials: fallback.financials,
    tasks: fallback.tasks,
    calendarEvents: fallback.calendarEvents,
    salesLedger: fallback.salesLedger,
  };
}

function LoginGate({ authError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(authError || '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Sign-in failed.');
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <div className="card-title">AIT CRM sign in</div>
        <p className="page-subtitle" style={{marginTop:0}}>
          Database-backed CRM data requires a signed-in user with server-owned permissions.
        </p>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </div>
        <div className="form-group">
          <label className="form-label">Password</label>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </div>
        {error && <div className="empty-state" style={{padding:10, marginBottom:12}}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export function CRMProvider({ children, initialData }) {
  const [bootstrapData] = useState(() => getInitialData(initialData));
  const isPostgres = bootstrapData.dataSource === 'postgres';
  const initialRole = bootstrapData.currentUser?.primaryRoleKey || 'admin';
  const [role, setRole] = useState(() => {
    if (isPostgres) return initialRole;
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
  const [currentUser] = useState(bootstrapData.currentUser);
  const [access] = useState(bootstrapData.access || {});
  const [importStaging] = useState(bootstrapData.importStaging);
  const [businessUnits, setBusinessUnits] = useState(bootstrapData.businessUnits);
  const [contacts, setContacts] = useState(bootstrapData.contacts);
  const [workOrders, setWorkOrders] = useState(bootstrapData.workOrders);
  const [financials, setFinancials] = useState(bootstrapData.financials);
  const [tasks, setTasks] = useState(bootstrapData.tasks);
  const [calendarEvents, setCalendarEvents] = useState(bootstrapData.calendarEvents);
  const [salesLedger, setSalesLedger] = useState(bootstrapData.salesLedger);
  const [storageReady, setStorageReady] = useState(isPostgres);
  const loaded = true;

  useEffect(() => {
    if (isPostgres) return;
    const stored = loadStorage();

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (stored) {
        setBusinessUnits(stored.businessUnits || defaults.businessUnits || []);
        setContacts(stored.contacts || defaults.contacts);
        setWorkOrders(stored.workOrders || defaults.workOrders);
        setFinancials(stored.financials || defaults.financials);
        setTasks(stored.tasks || defaults.tasks);
        setCalendarEvents(stored.calendarEvents || defaults.calendarEvents);
        setSalesLedger(stored.salesLedger || defaults.salesLedger);
      }
      setStorageReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isPostgres]);

  useEffect(() => {
    if (isPostgres) return;
    if (typeof window !== 'undefined') {
      localStorage.setItem('ait-crm-role', role);
    }
  }, [isPostgres, role]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('ait-crm-theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!loaded) return;
    if (isPostgres || !storageReady) return;
    saveStorage({ businessUnits, contacts, workOrders, financials, tasks, calendarEvents, salesLedger });
  }, [isPostgres, businessUnits, contacts, workOrders, financials, tasks, calendarEvents, salesLedger, loaded, storageReady]);

  const gid = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

  const callContactsApi = useCallback(async (method, body) => {
    if (!isPostgres) return null;
    const response = await fetch('/api/contacts', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Contact save failed.');
    return payload.contact || null;
  }, [isPostgres]);

  const updateContact = useCallback((id, u) => {
    setContacts(p => p.map(c => c.id===id ? {...c,...u} : c));
    if (isPostgres && access.canWriteCrm) {
      callContactsApi('PATCH', { id, ...u }).catch((error) => console.error(error));
    }
  }, [access.canWriteCrm, callContactsApi, isPostgres]);
  const addContact = useCallback((d) => {
    const tempId = gid('c');
    const draft = { id: tempId, ...d };
    setContacts(p => [draft,...p]);
    if (isPostgres && access.canWriteCrm) {
      callContactsApi('POST', d)
        .then((contact) => {
          if (contact) setContacts(p => p.map(c => c.id === tempId ? contact : c));
        })
        .catch((error) => {
          console.error(error);
          setContacts(p => p.filter(c => c.id !== tempId));
        });
    }
  }, [access.canWriteCrm, callContactsApi, isPostgres]);
  const deleteContact = useCallback((id) => {
    const existing = contacts.find(c => c.id === id);
    setContacts(p => p.filter(c => c.id!==id));
    if (isPostgres && access.canWriteCrm) {
      callContactsApi('DELETE', { id }).catch((error) => {
        console.error(error);
        if (existing) setContacts(p => [existing, ...p]);
      });
    }
  }, [access.canWriteCrm, callContactsApi, contacts, isPostgres]);

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

  const serverOwnedSetRole = useCallback((nextRole) => {
    if (isPostgres) return;
    setRole(nextRole);
  }, [isPostgres]);

  const value = {
    role, setRole: serverOwnedSetRole, theme, setTheme, loaded,
    dataSource: bootstrapData.dataSource,
    authRequired: bootstrapData.authRequired,
    currentUser,
    access,
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

  if (bootstrapData.authRequired) {
    return (
      <CRMContext.Provider value={value}>
        <LoginGate authError={bootstrapData.authError} />
      </CRMContext.Provider>
    );
  }

  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}

export function useCRM() {
  const c = useContext(CRMContext);
  if (!c) throw new Error('useCRM must be used within CRMProvider');
  return c;
}
