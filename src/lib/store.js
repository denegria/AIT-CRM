'use client';
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import * as defaults from './data';

const CRMContext = createContext(null);
const STORAGE_KEY = 'ait-crm-data';
const SCOPE_STORAGE_KEY = 'ait-crm-business-unit-scope';
const SCOPE_USER_KEY = 'ait-crm-scope-user-id';
const ALL_BUSINESS_UNITS = 'all';
const UNASSIGNED_BUSINESS_UNIT = 'unassigned';

function getBusinessUnitId(record) {
  return record?.businessUnitId || record?.primaryBusinessUnitId || '';
}

function withBusinessUnitDefaults(record, businessUnitId, includePrimary = false) {
  if (!businessUnitId || businessUnitId === ALL_BUSINESS_UNITS) return record;
  const hasBusinessUnitId = Object.prototype.hasOwnProperty.call(record, 'businessUnitId');
  const hasPrimaryBusinessUnitId = Object.prototype.hasOwnProperty.call(record, 'primaryBusinessUnitId');
  return {
    ...record,
    businessUnitId: hasBusinessUnitId ? record.businessUnitId : businessUnitId,
    ...(includePrimary ? { primaryBusinessUnitId: hasPrimaryBusinessUnitId ? record.primaryBusinessUnitId : businessUnitId } : {}),
  };
}

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
  const [currentBusinessUnitId, setCurrentBusinessUnitIdState] = useState(() => {
    if (typeof window === 'undefined') return ALL_BUSINESS_UNITS;
    // Reset persisted scope if the current user differs from the stored scope owner
    const storedUserId = localStorage.getItem(SCOPE_USER_KEY);
    const currentUserId = bootstrapData.currentUser?.id || null;
    if (isPostgres && currentUserId && storedUserId && storedUserId !== currentUserId) {
      localStorage.removeItem(SCOPE_STORAGE_KEY);
      localStorage.removeItem(SCOPE_USER_KEY);
      // Default to user's primary business unit or 'all'
      const userUnits = bootstrapData.currentUser?.businessUnitIds || [];
      return userUnits[0] || ALL_BUSINESS_UNITS;
    }
    return localStorage.getItem(SCOPE_STORAGE_KEY) || ALL_BUSINESS_UNITS;
  });
  const [storageReady, setStorageReady] = useState(isPostgres);
  const loaded = true;

  const accessibleBusinessUnits = useMemo(() => {
    const activeUnits = (businessUnits || []).filter((unit) => unit.isActive !== false);
    if (!currentUser || currentUser.canAccessAllBusinessUnits) return activeUnits;
    const allowed = new Set(currentUser.businessUnitIds || []);
    return activeUnits.filter((unit) => allowed.has(unit.id));
  }, [businessUnits, currentUser]);

  const canUseConsolidatedScope = Boolean(!currentUser || currentUser.canAccessAllBusinessUnits);
  const effectiveBusinessUnitId = useMemo(() => {
    if (currentBusinessUnitId === ALL_BUSINESS_UNITS && canUseConsolidatedScope) return ALL_BUSINESS_UNITS;
    if (currentBusinessUnitId === UNASSIGNED_BUSINESS_UNIT) return UNASSIGNED_BUSINESS_UNIT;
    const allowedIds = new Set(accessibleBusinessUnits.map((unit) => unit.id));
    if (allowedIds.has(currentBusinessUnitId)) return currentBusinessUnitId;
    return canUseConsolidatedScope ? ALL_BUSINESS_UNITS : accessibleBusinessUnits[0]?.id || ALL_BUSINESS_UNITS;
  }, [accessibleBusinessUnits, canUseConsolidatedScope, currentBusinessUnitId]);
  const currentBusinessUnit = useMemo(() => {
    if (effectiveBusinessUnitId === UNASSIGNED_BUSINESS_UNIT) {
      return { id: UNASSIGNED_BUSINESS_UNIT, name: 'No Division', label: businessUnits?.[0]?.label || 'Divisions' };
    }
    return accessibleBusinessUnits.find((unit) => unit.id === effectiveBusinessUnitId) || null;
  }, [accessibleBusinessUnits, businessUnits, effectiveBusinessUnitId]);
  const scopeLabel = currentBusinessUnit?.label || businessUnits?.[0]?.label || 'Divisions';

  const setCurrentBusinessUnitId = useCallback((nextId) => {
    const selectedId = nextId || ALL_BUSINESS_UNITS;
    const allowedIds = new Set(accessibleBusinessUnits.map((unit) => unit.id));
    if (selectedId === UNASSIGNED_BUSINESS_UNIT) {
      setCurrentBusinessUnitIdState(selectedId);
      if (typeof window !== 'undefined') {
        localStorage.setItem(SCOPE_STORAGE_KEY, selectedId);
      }
      return;
    }
    if (selectedId !== ALL_BUSINESS_UNITS && !allowedIds.has(selectedId)) return;
    if (selectedId === ALL_BUSINESS_UNITS && !canUseConsolidatedScope) return;
    setCurrentBusinessUnitIdState(selectedId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SCOPE_STORAGE_KEY, selectedId);
      const userId = currentUser?.id;
      if (userId) localStorage.setItem(SCOPE_USER_KEY, userId);
    }
  }, [accessibleBusinessUnits, canUseConsolidatedScope, currentUser?.id]);

  const inCurrentBusinessUnitScope = useCallback((record) => {
    if (effectiveBusinessUnitId === ALL_BUSINESS_UNITS) return true;
    const businessUnitId = getBusinessUnitId(record);
    if (effectiveBusinessUnitId === UNASSIGNED_BUSINESS_UNIT) return !businessUnitId;
    return businessUnitId === effectiveBusinessUnitId;
  }, [effectiveBusinessUnitId]);

  const businessUnitByContactId = useMemo(() => {
    const lookup = new Map();
    for (const contact of contacts) {
      lookup.set(contact.id, getBusinessUnitId(contact));
    }
    return lookup;
  }, [contacts]);
  const inCurrentBusinessUnitOrContactScope = useCallback((record) => {
    if (effectiveBusinessUnitId === ALL_BUSINESS_UNITS) return true;
    const businessUnitId = getBusinessUnitId(record);
    const contactBusinessUnitId = businessUnitByContactId.get(record?.contactId);
    if (effectiveBusinessUnitId === UNASSIGNED_BUSINESS_UNIT) {
      return !businessUnitId && !contactBusinessUnitId;
    }
    return (
      businessUnitId === effectiveBusinessUnitId ||
      contactBusinessUnitId === effectiveBusinessUnitId
    );
  }, [businessUnitByContactId, effectiveBusinessUnitId]);

  const scopedContacts = useMemo(() => contacts.filter(inCurrentBusinessUnitScope), [contacts, inCurrentBusinessUnitScope]);
  const scopedWorkOrders = useMemo(() => workOrders.filter(inCurrentBusinessUnitScope), [workOrders, inCurrentBusinessUnitScope]);
  const scopedFinancials = useMemo(() => financials.filter(inCurrentBusinessUnitScope), [financials, inCurrentBusinessUnitScope]);
  const scopedTasks = useMemo(() => tasks.filter(inCurrentBusinessUnitScope), [tasks, inCurrentBusinessUnitScope]);
  const scopedCalendarEvents = useMemo(() => calendarEvents.filter(inCurrentBusinessUnitOrContactScope), [calendarEvents, inCurrentBusinessUnitOrContactScope]);
  const scopedSalesLedger = useMemo(() => salesLedger.filter(inCurrentBusinessUnitOrContactScope), [salesLedger, inCurrentBusinessUnitOrContactScope]);

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

  const callWorkOrdersApi = useCallback(async (method, body) => {
    if (!isPostgres) return null;
    const response = await fetch('/api/work-orders', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Work order save failed.');
    return payload.workOrder || null;
  }, [isPostgres]);

  const updateContact = useCallback((id, u) => {
    const existing = contacts.find(c => c.id === id);
    setContacts(p => p.map(c => c.id===id ? {...c,...u} : c));
    if (isPostgres && access.canWriteCrm) {
      return callContactsApi('PATCH', { id, ...u })
        .then((contact) => {
          if (contact) setContacts(p => p.map(c => c.id === id ? contact : c));
          return contact;
        })
        .catch((error) => {
          console.error(error);
          if (existing) setContacts(p => p.map(c => c.id === id ? existing : c));
          throw error;
        });
    }
    return Promise.resolve(null);
  }, [access.canWriteCrm, callContactsApi, contacts, isPostgres]);
  const addContact = useCallback((d) => {
    const tempId = gid('c');
    const payload = withBusinessUnitDefaults(d, effectiveBusinessUnitId, true);
    const draft = { id: tempId, ...payload };
    setContacts(p => [draft,...p]);
    if (isPostgres && access.canWriteCrm) {
      callContactsApi('POST', payload)
        .then((contact) => {
          if (contact) setContacts(p => p.map(c => c.id === tempId ? contact : c));
        })
        .catch((error) => {
          console.error(error);
          setContacts(p => p.filter(c => c.id !== tempId));
        });
    }
  }, [access.canWriteCrm, callContactsApi, effectiveBusinessUnitId, isPostgres]);
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

  const updateWorkOrder = useCallback((id, u) => {
    const existing = workOrders.find((workOrder) => workOrder.id === id);
    setWorkOrders((prev) => prev.map((workOrder) => (workOrder.id === id ? { ...workOrder, ...u } : workOrder)));
    if (isPostgres && access.canWriteWorkOrders) {
      return callWorkOrdersApi('PATCH', { id, ...u })
        .then((workOrder) => {
          if (workOrder) setWorkOrders((prev) => prev.map((row) => (row.id === id ? workOrder : row)));
          return workOrder;
        })
        .catch((error) => {
          console.error(error);
          if (existing) setWorkOrders((prev) => prev.map((row) => (row.id === id ? existing : row)));
          throw error;
        });
    }
    return Promise.resolve(null);
  }, [access.canWriteWorkOrders, callWorkOrdersApi, isPostgres, workOrders]);
  const addWorkOrder = useCallback((d) => {
    const tempId = gid('wo');
    const payload = withBusinessUnitDefaults(d, effectiveBusinessUnitId);
    const draft = { id: tempId, ...payload };
    setWorkOrders((prev) => [draft, ...prev]);
    if (isPostgres && access.canWriteWorkOrders) {
      return callWorkOrdersApi('POST', payload)
        .then((workOrder) => {
          if (workOrder) setWorkOrders((prev) => prev.map((row) => (row.id === tempId ? workOrder : row)));
          return workOrder;
        })
        .catch((error) => {
          console.error(error);
          setWorkOrders((prev) => prev.filter((row) => row.id !== tempId));
          throw error;
        });
    }
    return Promise.resolve(draft);
  }, [access.canWriteWorkOrders, callWorkOrdersApi, effectiveBusinessUnitId, isPostgres]);
  const deleteWorkOrder = useCallback((id) => {
    const existing = workOrders.find((workOrder) => workOrder.id === id);
    setWorkOrders((prev) => prev.filter((workOrder) => workOrder.id !== id));
    if (isPostgres && access.canWriteWorkOrders) {
      return callWorkOrdersApi('DELETE', { id })
        .catch((error) => {
          console.error(error);
          if (existing) setWorkOrders((prev) => [existing, ...prev]);
          throw error;
        });
    }
    return Promise.resolve(null);
  }, [access.canWriteWorkOrders, callWorkOrdersApi, isPostgres, workOrders]);

  const updateFinancial = useCallback((id, u) => setFinancials(p => p.map(f => f.id===id ? {...f,...u} : f)), []);
  const addFinancial = useCallback((d) => setFinancials(p => [{id:gid('f'),...withBusinessUnitDefaults(d, effectiveBusinessUnitId)},...p]), [effectiveBusinessUnitId]);
  const deleteFinancial = useCallback((id) => setFinancials(p => p.filter(f => f.id!==id)), []);

  const updateTask = useCallback((id, u) => setTasks(p => p.map(t => t.id===id ? {...t,...u} : t)), []);
  const addTask = useCallback((d) => setTasks(p => [{id:gid('t'),...withBusinessUnitDefaults(d, effectiveBusinessUnitId)},...p]), [effectiveBusinessUnitId]);
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
    accessibleBusinessUnits,
    currentBusinessUnitId: effectiveBusinessUnitId, currentBusinessUnit, setCurrentBusinessUnitId,
    canUseConsolidatedScope,
    scopeLabel,
    contacts: scopedContacts, allContacts: contacts, addContact, updateContact, deleteContact,
    workOrders: scopedWorkOrders, allWorkOrders: workOrders, addWorkOrder, updateWorkOrder, deleteWorkOrder,
    financials: scopedFinancials, allFinancials: financials, addFinancial, updateFinancial, deleteFinancial,
    tasks: scopedTasks, allTasks: tasks, addTask, updateTask, deleteTask,
    calendarEvents: scopedCalendarEvents, allCalendarEvents: calendarEvents, addCalendarEvent, deleteCalendarEvent,
    salesLedger: scopedSalesLedger, allSalesLedger: salesLedger, addSalesEntry,
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
