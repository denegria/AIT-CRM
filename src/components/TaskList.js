'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createDashboardTaskCompletionController } from '@/lib/dashboard/task-completion.js';
import { TaskCompletionControl } from './TaskCompletionControl.js';
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
  canToggle = true,
  emptyText = 'No tasks yet.',
}) {
  const [newTask, setNewTask] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [taskMutations, setTaskMutations] = useState({});
  const [taskCompletionController] = useState(() => (
    createDashboardTaskCompletionController({
      onStateChange: (taskId, state) => setTaskMutations((current) => ({
        ...current,
        [taskId]: state,
      })),
    })
  ));
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

  const handleToggle = async (task) => {
    if (!onToggle || !canToggle) return;
    try {
      await taskCompletionController.submit({
        taskId: task.id,
        complete: () => onToggle(task.id, { completed: !task.completed }),
      });
    } catch {
      // The row remains open and exposes the server-provided failure inline.
    }
  };

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
              <TaskCompletionControl
                task={t}
                mutation={taskMutations[t.id]}
                onComplete={() => handleToggle(t)}
                canComplete={canToggle}
                styles={s}
              />
            )}
            <div className={s.content}>
              {t.id ? (
                <Link className={`${s.taskTitle} ${s.taskTitleLink} ${t.completed ? s.taskTitleDone : ''}`} href={`/tasks/${encodeURIComponent(t.id)}`}>
                  {t.title}
                </Link>
              ) : (
                <div className={`${s.taskTitle} ${t.completed ? s.taskTitleDone : ''}`}>{t.title}</div>
              )}
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
