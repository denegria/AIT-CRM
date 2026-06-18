'use client';
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  publishActiveSession,
  sessionIdentityForUser,
} from '@/lib/auth/session-sync.js';
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

function defaultBusinessUnitScope({ businessUnits = [], currentUser = null, contacts = [] } = {}) {
  const activeUnits = (businessUnits || []).filter((unit) => unit.isActive !== false);
  const allowedIds = currentUser?.canAccessAllBusinessUnits
    ? activeUnits.map((unit) => unit.id)
    : currentUser?.businessUnitIds || activeUnits.map((unit) => unit.id);
  const allowedSet = new Set(allowedIds);
  if (!currentUser?.canAccessAllBusinessUnits && currentUser?.primaryBusinessUnitId && allowedSet.has(currentUser.primaryBusinessUnitId)) {
    return currentUser.primaryBusinessUnitId;
  }
  const counts = new Map();
  for (const contact of contacts || []) {
    const businessUnitId = getBusinessUnitId(contact);
    if (!businessUnitId || !allowedSet.has(businessUnitId)) continue;
    counts.set(businessUnitId, (counts.get(businessUnitId) || 0) + 1);
  }
  const preferredUnit = activeUnits
    .filter((unit) => allowedSet.has(unit.id))
    .sort((left, right) => (counts.get(right.id) || 0) - (counts.get(left.id) || 0))[0];
  return preferredUnit?.id || allowedIds.find((id) => activeUnits.some((unit) => unit.id === id)) || activeUnits[0]?.id || ALL_BUSINESS_UNITS;
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
    employees: fallback.employees || defaults.EMPLOYEES || [],
    contacts: fallback.contacts,
    workOrders: fallback.workOrders,
    financials: fallback.financials,
    tasks: fallback.tasks,
    calendarEvents: fallback.calendarEvents,
    salesLedger: fallback.salesLedger,
  };
}

function crmWriteAccessError() {
  return new Error('Insufficient CRM write access.');
}

function LoginGate({ authError }) {
  const router = useRouter();
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
      const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store' }).catch(() => null);
      const sessionPayload = await sessionResponse?.json?.().catch(() => ({}));
      if (sessionPayload?.user) {
        publishActiveSession(sessionIdentityForUser(sessionPayload.user), 'login');
      }
      router.refresh();
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
  const pathname = usePathname();
  const [bootstrapData] = useState(() => getInitialData(initialData));
  const isPublicJoinPage = pathname === '/join';
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
  const [employees] = useState(bootstrapData.employees);
  const [contacts, setContacts] = useState(bootstrapData.contacts);
  const [workOrders, setWorkOrders] = useState(bootstrapData.workOrders);
  const [financials, setFinancials] = useState(bootstrapData.financials);
  const [tasks, setTasks] = useState(bootstrapData.tasks);
  const [calendarEvents, setCalendarEvents] = useState(bootstrapData.calendarEvents);
  const [salesLedger, setSalesLedger] = useState(bootstrapData.salesLedger);
  const [currentBusinessUnitId, setCurrentBusinessUnitIdState] = useState(() => {
    return defaultBusinessUnitScope({
      businessUnits: bootstrapData.businessUnits,
      currentUser: bootstrapData.currentUser,
      contacts: bootstrapData.contacts,
    });
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
    if (currentBusinessUnitId === UNASSIGNED_BUSINESS_UNIT) return UNASSIGNED_BUSINESS_UNIT;
    const allowedIds = new Set(accessibleBusinessUnits.map((unit) => unit.id));
    if (allowedIds.has(currentBusinessUnitId)) return currentBusinessUnitId;
    return accessibleBusinessUnits[0]?.id || ALL_BUSINESS_UNITS;
  }, [accessibleBusinessUnits, currentBusinessUnitId]);
  const currentBusinessUnit = useMemo(() => {
    if (effectiveBusinessUnitId === UNASSIGNED_BUSINESS_UNIT) {
      return { id: UNASSIGNED_BUSINESS_UNIT, name: 'No Division', label: businessUnits?.[0]?.label || 'Divisions' };
    }
    return accessibleBusinessUnits.find((unit) => unit.id === effectiveBusinessUnitId) || null;
  }, [accessibleBusinessUnits, businessUnits, effectiveBusinessUnitId]);
  const scopeLabel = currentBusinessUnit?.label || businessUnits?.[0]?.label || 'Divisions';

  useEffect(() => {
    if (typeof window === 'undefined' || !isPostgres) return undefined;
    if (currentUser && !currentUser.canAccessAllBusinessUnits) return undefined;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const storedUserId = localStorage.getItem(SCOPE_USER_KEY);
      const currentUserId = currentUser?.id || null;
      if (currentUserId && storedUserId && storedUserId !== currentUserId) {
        localStorage.removeItem(SCOPE_STORAGE_KEY);
        localStorage.removeItem(SCOPE_USER_KEY);
        return;
      }

      const storedScope = localStorage.getItem(SCOPE_STORAGE_KEY);
      const allowedIds = new Set(accessibleBusinessUnits.map((unit) => unit.id));
      if (storedScope === UNASSIGNED_BUSINESS_UNIT || allowedIds.has(storedScope)) {
        setCurrentBusinessUnitIdState(storedScope);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [accessibleBusinessUnits, currentUser, currentUser?.id, isPostgres]);

  const setCurrentBusinessUnitId = useCallback((nextId) => {
    const selectedId = nextId || accessibleBusinessUnits[0]?.id || ALL_BUSINESS_UNITS;
    const allowedIds = new Set(accessibleBusinessUnits.map((unit) => unit.id));
    if (selectedId === UNASSIGNED_BUSINESS_UNIT) {
      setCurrentBusinessUnitIdState(selectedId);
      if (typeof window !== 'undefined') {
        localStorage.setItem(SCOPE_STORAGE_KEY, selectedId);
      }
      return;
    }
    if (selectedId === ALL_BUSINESS_UNITS) return;
    if (selectedId !== ALL_BUSINESS_UNITS && !allowedIds.has(selectedId)) return;
    setCurrentBusinessUnitIdState(selectedId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SCOPE_STORAGE_KEY, selectedId);
      const userId = currentUser?.id;
      if (userId) localStorage.setItem(SCOPE_USER_KEY, userId);
    }
  }, [accessibleBusinessUnits, currentUser?.id]);

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

  const callPaymentsApi = useCallback(async (method, body) => {
    if (!isPostgres) return null;
    const response = await fetch('/api/payments', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Payment save failed.');
    return payload.receipt || null;
  }, [isPostgres]);

  const callFinancialDocumentsApi = useCallback(async (method, body) => {
    if (!isPostgres) return null;
    const response = await fetch('/api/financial-documents', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Financial document save failed.');
    return payload.financial || null;
  }, [isPostgres]);

  const updateContact = useCallback((id, u) => {
    if (isPostgres && !access.canWriteCrm) {
      return Promise.reject(crmWriteAccessError());
    }
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
    if (isPostgres && !access.canWriteCrm) {
      return Promise.reject(crmWriteAccessError());
    }
    const tempId = gid('c');
    const payload = withBusinessUnitDefaults(d, effectiveBusinessUnitId, true);
    const draft = { id: tempId, ...payload };
    setContacts(p => [draft,...p]);
    if (isPostgres && access.canWriteCrm) {
      return callContactsApi('POST', payload)
        .then((contact) => {
          if (contact) setContacts(p => p.map(c => c.id === tempId ? contact : c));
          return contact;
        })
        .catch((error) => {
          console.error(error);
          setContacts(p => p.filter(c => c.id !== tempId));
          throw error;
        });
    }
    return Promise.resolve(draft);
  }, [access.canWriteCrm, callContactsApi, effectiveBusinessUnitId, isPostgres]);
  const deleteContact = useCallback((id, options = {}) => {
    if (isPostgres && !access.canWriteCrm) {
      return Promise.reject(crmWriteAccessError());
    }
    const existing = contacts.find(c => c.id === id);
    setContacts(p => p.filter(c => c.id!==id));
    if (isPostgres && access.canWriteCrm) {
      return callContactsApi('DELETE', { id, ...options }).catch((error) => {
        console.error(error);
        if (existing) setContacts(p => [existing, ...p]);
        throw error;
      });
    }
    return Promise.resolve({ id });
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
  const addFinancial = useCallback((d) => {
    if (isPostgres && !access.canWriteFinancials) {
      return Promise.reject(new Error('Insufficient financial write access.'));
    }
    const tempId = gid('f');
    const payload = withBusinessUnitDefaults(d, effectiveBusinessUnitId);
    const draft = { id: tempId, ...payload };
    setFinancials(p => [draft, ...p]);
    if (isPostgres && access.canWriteFinancials && ['Estimate', 'Invoice'].includes(payload.type)) {
      return callFinancialDocumentsApi('POST', payload)
        .then((financial) => {
          if (financial) setFinancials(p => p.map(f => f.id === tempId ? financial : f));
          return financial || draft;
        })
        .catch((error) => {
          console.error(error);
          setFinancials(p => p.filter(f => f.id !== tempId));
          throw error;
        });
    }
    return Promise.resolve(draft);
  }, [access.canWriteFinancials, callFinancialDocumentsApi, effectiveBusinessUnitId, isPostgres]);
  const deleteFinancial = useCallback((id) => setFinancials(p => p.filter(f => f.id!==id)), []);
  const recordPayment = useCallback((d) => {
    if (isPostgres && !access.canWriteFinancials) {
      return Promise.reject(new Error('Insufficient financial write access.'));
    }
    const payload = withBusinessUnitDefaults(d, effectiveBusinessUnitId);
    if (isPostgres && access.canWriteFinancials) {
      return callPaymentsApi('POST', payload)
        .then((receipt) => {
          if (receipt) setFinancials((prev) => [receipt, ...prev]);
          return receipt;
        });
    }
    const amount = Number(payload.amount || 0);
    const receipt = {
      id: gid('pay'),
      number: `REC-${String(financials.filter((row) => row.type === 'Receipt').length + 1).padStart(3, '0')}`,
      type: 'Receipt',
      client: payload.client || contacts.find((contact) => contact.id === payload.contactId)?.name || '',
      amount,
      paidAmount: amount,
      paymentMethod: payload.paymentMethod || '',
      checkNumber: payload.checkNumber || '',
      date: payload.paidAt || new Date().toISOString().slice(0, 10),
      status: 'Paid',
      items: [{ desc: 'Payment received', qty: 1, rate: amount, amount }],
      ...payload,
    };
    setFinancials((prev) => [receipt, ...prev]);
    return Promise.resolve(receipt);
  }, [access.canWriteFinancials, callPaymentsApi, contacts, effectiveBusinessUnitId, financials, isPostgres]);

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
    financials: scopedFinancials, allFinancials: financials, addFinancial, updateFinancial, deleteFinancial, recordPayment,
    tasks: scopedTasks, allTasks: tasks, addTask, updateTask, deleteTask,
    calendarEvents: scopedCalendarEvents, allCalendarEvents: calendarEvents, addCalendarEvent, deleteCalendarEvent,
    salesLedger: scopedSalesLedger, allSalesLedger: salesLedger, addSalesEntry,
    employees: isPostgres ? employees : defaults.EMPLOYEES,
    statuses: defaults.STATUSES,
    sources: defaults.SOURCES,
    resetData,
  };

  if (bootstrapData.authRequired && !isPublicJoinPage) {
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
