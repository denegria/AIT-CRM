'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, User, ClipboardList, FileText, X } from 'lucide-react';
import { useCRM } from '@/lib/store';
import { fetchGlobalSearch } from '@/lib/search/loader.js';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState([]);
  const [remoteResultQuery, setRemoteResultQuery] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const router = useRouter();
  const {
    contacts,
    workOrders,
    financials,
    role,
    access,
    currentBusinessUnitId,
    contactDirectoryIsDeferred,
    dashboardSummaryIsDeferred,
    pipelineSummaryIsDeferred,
    leanShellIsDeferred,
  } = useCRM();
  const inputRef = useRef(null);
  const usesRemoteSearch = Boolean(contactDirectoryIsDeferred || dashboardSummaryIsDeferred || pipelineSummaryIsDeferred || leanShellIsDeferred);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !usesRemoteSearch || query.trim().length < 2) {
      return undefined;
    }
    const controller = new AbortController();
    const requestedQuery = query.trim();
    const timer = window.setTimeout(() => {
      setRemoteLoading(true);
      setRemoteError('');
      fetchGlobalSearch({ query, businessUnitId: currentBusinessUnitId, signal: controller.signal })
        .then((results) => {
          setRemoteResults(results);
          setRemoteResultQuery(requestedQuery);
        })
        .catch((error) => {
          if (error?.name !== 'AbortError') {
            setRemoteResults([]);
            setRemoteResultQuery(requestedQuery);
            setRemoteError(error?.message || 'Search could not load.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setRemoteLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentBusinessUnitId, open, query, usesRemoteSearch]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    if (usesRemoteSearch) {
      if (query.trim().length < 2) return [];
      if (remoteResultQuery !== query.trim()) return [];
      return remoteResults.map((result) => ({
        ...result,
        icon: result.type === 'contact'
          ? <User size={16} />
          : result.type === 'work-order'
            ? <ClipboardList size={16} />
            : <FileText size={16} />,
      }));
    }
    const q = query.toLowerCase();
    
    const matchedContacts = contacts.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .map(c => ({ id: c.id, title: c.name, subtitle: c.email, type: 'contact', icon: <User size={16} />, path: `/contacts/${c.id}` }));
    
    const matchedWO = workOrders.filter(w => w.title.toLowerCase().includes(q) || w.number.toLowerCase().includes(q))
      .map(w => ({ id: w.id, title: w.title, subtitle: w.number, type: 'work-order', icon: <ClipboardList size={16} />, path: `/work-orders/${w.id}` }));
    
    const canUseFinancialsWorkspace = Boolean(access?.canReadSettings || access?.canReadReports || role === 'admin');
    const matchedFin = canUseFinancialsWorkspace
      ? financials.filter(f => f.number.toLowerCase().includes(q) || f.client.toLowerCase().includes(q))
        .map(f => ({
          id: f.id,
          title: `${f.type} ${f.number}`,
          subtitle: f.client,
          type: 'financial',
          icon: <FileText size={16} />,
          path: f.contactId ? `/contacts/${f.contactId}` : '/financials',
        }))
      : [];

    return [...matchedContacts, ...matchedWO, ...matchedFin].slice(0, 10);
  }, [query, contacts, workOrders, financials, access?.canReadReports, access?.canReadSettings, remoteResultQuery, remoteResults, role, usesRemoteSearch]);

  const waitingForRemoteResults = usesRemoteSearch && query.trim().length >= 2 && (
    remoteLoading || remoteResultQuery !== query.trim()
  );
  const visibleRemoteError = remoteResultQuery === query.trim() ? remoteError : '';

  const navigate = (path) => {
    router.push(path);
    setOpen(false);
    setQuery('');
  };

  if (!open) return null;

  return (
    <div className="cp-overlay" onClick={() => setOpen(false)}>
      <div className="cp-box" onClick={e => e.stopPropagation()}>
        <div className="cp-header">
          <Search className="cp-icon" size={20} />
          <input 
            ref={inputRef}
            className="cp-input" 
            placeholder="Search contacts, work orders, invoices..." 
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <kbd className="cp-kbd">ESC</kbd>
        </div>

        <div className="cp-body">
          {results.length > 0 ? (
            results.map((r, i) => (
              <div key={r.id + i} className="cp-item" onClick={() => navigate(r.path)}>
                <div className="cp-item-icon">{r.icon}</div>
                <div className="cp-item-info">
                  <div className="cp-item-title">{r.title}</div>
                  <div className="cp-item-subtitle">{r.subtitle}</div>
                </div>
                <div className="cp-item-type">{r.type}</div>
              </div>
            ))
          ) : waitingForRemoteResults ? (
            <div className="cp-empty">Searching...</div>
          ) : visibleRemoteError ? (
            <div className="cp-empty">{visibleRemoteError}</div>
          ) : query ? (
            <div className="cp-empty">No results for &quot;{query}&quot;</div>
          ) : (
            <div className="cp-hint">Type to search across everything...</div>
          )}
        </div>
      </div>

      <style jsx>{`
        .cp-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.4);
          backdrop-filter: blur(4px);
          z-index: 10000;
          display: flex;
          justify-content: center;
          padding-top: 15vh;
        }
        .cp-box {
          width: 100%;
          max-width: 600px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          display: flex;
          flex-direction: column;
          max-height: 400px;
          animation: scaleUp 0.1s ease-out;
        }
        .cp-header {
          display: flex;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid var(--border-subtle);
          gap: 12px;
        }
        .cp-icon { color: var(--text-muted); }
        .cp-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-size: var(--text-md);
          color: var(--text-primary);
        }
        .cp-kbd {
          font-size: 10px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--text-muted);
        }
        .cp-body {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }
        .cp-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: background 0.1s;
        }
        .cp-item:hover {
          background: var(--bg-hover);
        }
        .cp-item-icon {
          width: 32px;
          height: 32px;
          background: var(--bg-tertiary);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }
        .cp-item-info { flex: 1; }
        .cp-item-title { font-weight: 600; font-size: var(--text-sm); }
        .cp-item-subtitle { font-size: var(--text-xs); color: var(--text-muted); }
        .cp-item-type {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 2px 6px;
          border-radius: 4px;
        }
        .cp-empty, .cp-hint {
          padding: 32px;
          text-align: center;
          color: var(--text-muted);
          font-size: var(--text-sm);
        }
        @keyframes scaleUp {
          from { transform: scale(0.98); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
