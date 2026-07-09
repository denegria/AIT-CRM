'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { useCRM } from '@/lib/store';
import s from './NotificationBell.module.css';

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function NotificationBell() {
  const { dataSource, currentUser, access } = useCRM();
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const panelRef = useRef(null);
  const enabled = dataSource === 'postgres' && currentUser && access.canReadCrm;

  const loadNotifications = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/notifications?limit=8', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Notification load failed.');
      setItems(payload.notifications || []);
      setUnreadCount(Number(payload.unreadCount || 0));
    } catch (error) {
      console.error(error);
      setLoadError('Notifications unavailable');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const markRead = useCallback(async (ids, all = false) => {
    if (!enabled) return;
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(all ? { all: true } : { ids }),
      });
      if (!response.ok) throw new Error('Notification update failed.');
      await loadNotifications();
    } catch (error) {
      console.error(error);
    }
  }, [enabled, loadNotifications]);

  useEffect(() => {
    queueMicrotask(loadNotifications);
    if (!enabled) return undefined;
    const interval = setInterval(loadNotifications, 60000);
    return () => clearInterval(interval);
  }, [enabled, loadNotifications]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  if (!enabled) return null;

  return (
    <div className={s.wrap} ref={panelRef}>
      <button
        type="button"
        className={s.trigger}
        aria-label="Notifications"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((open) => !open);
          if (!isOpen) loadNotifications();
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && <span className={s.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {isOpen && (
        <div className={s.panel}>
          <div className={s.header}>
            <div>
              <strong>Notifications</strong>
              <span>{unreadCount} unread</span>
            </div>
            {unreadCount > 0 && (
              <button type="button" className={s.markAll} onClick={() => markRead([], true)}>
                <Check size={14} />
                <span>Clear</span>
              </button>
            )}
          </div>
          <div className={s.list}>
            {loading && !items.length && <div className={s.empty}>Loading notifications</div>}
            {!loading && loadError && !items.length && (
              <div className={s.stateBlock}>
                <span>{loadError}</span>
                <button type="button" onClick={loadNotifications}>Retry</button>
              </div>
            )}
            {!loading && !loadError && !items.length && <div className={s.empty}>No new notifications</div>}
            {items.map((item) => (
              <div key={item.id} className={`${s.item} ${item.readAt ? '' : s.unread}`}>
                <Link href={item.href || '/pipeline'} className={s.itemLink} onClick={() => {
                  setIsOpen(false);
                  if (!item.readAt) markRead([item.id]);
                }}>
                  <span className={s.itemTitle}>{item.title}</span>
                  <span className={s.itemBody}>{item.body}</span>
                  <span className={s.itemMeta}>{timeLabel(item.createdAt)} <ExternalLink size={12} /></span>
                </Link>
                {!item.readAt && (
                  <button type="button" className={s.itemRead} aria-label="Mark notification read" onClick={() => markRead([item.id])}>
                    <Check size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
