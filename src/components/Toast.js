'use client';
import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((msg, type = 'success') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => remove(id), 5000);
  }, [remove]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type} fade-in`}>
            <div className="toast-icon">
              {t.type === 'success' && <CheckCircle size={18} />}
              {t.type === 'error' && <AlertCircle size={18} />}
              {t.type === 'info' && <Info size={18} />}
            </div>
            <div className="toast-msg">{t.msg}</div>
            <button className="toast-close" onClick={() => remove(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style jsx>{`
        .toast-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 12px;
          pointer-events: none;
        }
        .toast {
          pointer-events: auto;
          min-width: 280px;
          max-width: 400px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: var(--shadow-lg);
          animation: slideIn 0.3s ease;
        }
        .toast-success { border-left: 4px solid var(--success); }
        .toast-error { border-left: 4px solid var(--danger); }
        .toast-info { border-left: 4px solid var(--accent); }
        
        .toast-icon { display: flex; align-items: center; }
        .toast-success .toast-icon { color: var(--success); }
        .toast-error .toast-icon { color: var(--danger); }
        .toast-info .toast-icon { color: var(--accent); }
        
        .toast-msg {
          flex: 1;
          font-size: var(--text-sm);
          color: var(--text-primary);
          font-weight: 500;
        }
        .toast-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          border-radius: var(--radius-sm);
        }
        .toast-close:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastContext);
  if (!c) throw new Error('useToast must be used within ToastProvider');
  return c;
}
