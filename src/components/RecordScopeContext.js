'use client';

import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';

const RecordScopeContext = createContext(null);

function recordScopeBusinessUnit(businessUnit) {
  if (!businessUnit?.id) return null;
  return {
    id: businessUnit.id,
    name: businessUnit.name || businessUnit.label || 'Record division',
    label: businessUnit.label || '',
  };
}

export function RecordScopeProvider({ children }) {
  const [recordScope, setRecordScopeState] = useState(null);

  const registerRecordScope = useCallback((businessUnit, ownerKey) => {
    const normalizedBusinessUnit = recordScopeBusinessUnit(businessUnit);
    if (!normalizedBusinessUnit || !ownerKey) return;
    setRecordScopeState({ businessUnit: normalizedBusinessUnit, ownerKey });
  }, []);

  const clearRecordScope = useCallback((ownerKey) => {
    if (!ownerKey) return;
    setRecordScopeState((current) => (current?.ownerKey === ownerKey ? null : current));
  }, []);

  const value = useMemo(() => ({
    recordBusinessUnit: recordScope?.businessUnit || null,
    registerRecordScope,
    clearRecordScope,
  }), [clearRecordScope, recordScope?.businessUnit, registerRecordScope]);

  return <RecordScopeContext.Provider value={value}>{children}</RecordScopeContext.Provider>;
}

export function useRecordScope() {
  return useContext(RecordScopeContext) || {
    recordBusinessUnit: null,
    registerRecordScope: () => {},
    clearRecordScope: () => {},
  };
}

export function useRecordScopeRegistration(businessUnit, ownerKey) {
  const { registerRecordScope, clearRecordScope } = useRecordScope();
  const businessUnitId = businessUnit?.id || '';
  const businessUnitName = businessUnit?.name || businessUnit?.label || '';
  const businessUnitLabel = businessUnit?.label || '';

  useEffect(() => {
    if (!businessUnitId || !ownerKey) return undefined;
    registerRecordScope({
      id: businessUnitId,
      name: businessUnitName,
      label: businessUnitLabel,
    }, ownerKey);
    return () => clearRecordScope(ownerKey);
  }, [businessUnitId, businessUnitLabel, businessUnitName, clearRecordScope, ownerKey, registerRecordScope]);
}
