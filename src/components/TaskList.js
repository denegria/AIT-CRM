'use client';
import { useState } from 'react';
import Link from 'next/link';
import s from './TaskList.module.css';

export default function TaskList({
  tasks,
  onToggle,
  onAdd,
  employees,
  owners,
  canAdd = true,
  ownerRequired = false,
  fixedOwnerId = '',
  showOwnerSelect = true,
  emptyText = 'No tasks yet.',
}) {
  const [newTask, setNewTask] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const ownerOptions = owners || employees || [];
  const defaultOwnerId = ownerOptions[0]?.id || '';
  const selectedOwnerId = fixedOwnerId || ownerId || (ownerRequired ? defaultOwnerId : '');

  const handleAdd = async () => {
    if (!newTask.trim() || !dueDate || busy || !canAdd) return;
    const effectiveOwnerId = fixedOwnerId || ownerId || (ownerRequired ? defaultOwnerId : '');
    if (ownerRequired && !effectiveOwnerId) {
      setError('Task owner is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onAdd({
        title: newTask.trim(),
        dueDate,
        completed: false,
        priority: 'Medium',
        assignedTo: effectiveOwnerId,
        ownerUserId: effectiveOwnerId,
      });
      setNewTask('');
    } catch (err) {
      setError(err.message || 'Task could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const empName = (id) => employees?.find(e => e.id === id)?.name || '';

  return (
    <div>
      <div className={s.list}>
        {tasks.length === 0 && <div className={s.empty}>{emptyText}</div>}
        {tasks.map(t => {
          const isFollowUpTask = t.taskType === 'follow_up';
          return (
          <div key={t.id} className={s.item}>
            {isFollowUpTask && !t.completed ? (
              <Link className={s.logButton} href={`/tasks?contactId=${encodeURIComponent(t.contactId || '')}&taskType=follow_up`}>
                Log
              </Link>
            ) : (
              <button className={`${s.check} ${t.completed ? s.checked : ''}`} onClick={() => onToggle(t.id, { completed: !t.completed })}>
                {t.completed ? '✓' : ''}
              </button>
            )}
            <div className={s.content}>
              <div className={`${s.taskTitle} ${t.completed ? s.taskTitleDone : ''}`}>{t.title}</div>
              <div className={s.meta}>
                <span className={`${s.metaItem} ${t.dueDate <= today && !t.completed ? s.overdue : ''}`}>
                  {t.dueDate === today ? 'Today' : t.dueDate}
                </span>
                {empName(t.assignedTo) && <span className={s.metaItem}>· {empName(t.assignedTo)}</span>}
                <span className={`badge badge-${t.priority?.toLowerCase()}`} style={{fontSize:'0.6rem',padding:'1px 6px'}}>{t.priority}</span>
              </div>
            </div>
            <div className={s.quickActions}>
              {t.contactId && (
                <Link className={s.quickLink} href={`/contacts/${encodeURIComponent(t.contactId)}`}>
                  Contact
                </Link>
              )}
              {isFollowUpTask && (
                <Link className={s.quickLink} href={`/tasks?contactId=${encodeURIComponent(t.contactId || '')}&taskType=follow_up`}>
                  Follow-up
                </Link>
              )}
            </div>
          </div>
        );})}
      </div>
      {onAdd && (
        <>
          <div className={`${s.addRow} ${!showOwnerSelect ? s.addRowCompact : ''}`}>
            <input
              className={s.addInput}
              placeholder="Add a task..."
              value={newTask}
              disabled={busy || !canAdd}
              onChange={e => setNewTask(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <input
              className={s.dateInput}
              type="date"
              value={dueDate}
              required
              disabled={busy || !canAdd}
              onChange={e => setDueDate(e.target.value)}
            />
            {showOwnerSelect && (
              <select className={s.ownerSelect} value={selectedOwnerId} disabled={busy || !canAdd || Boolean(fixedOwnerId)} onChange={e => setOwnerId(e.target.value)}>
                {ownerRequired ? <option value="" disabled>Select owner</option> : <option value="">Unassigned</option>}
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name || owner.email}</option>
                ))}
              </select>
            )}
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={busy || !canAdd || !newTask.trim() || !dueDate || (ownerRequired && !selectedOwnerId)}>Add</button>
          </div>
          {error && <div className={s.error}>{error}</div>}
        </>
      )}
    </div>
  );
}
