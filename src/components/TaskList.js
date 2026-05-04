'use client';
import { useState } from 'react';
import s from './TaskList.module.css';

export default function TaskList({ tasks, onToggle, onAdd, employees }) {
  const [newTask, setNewTask] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  const handleAdd = () => {
    if (!newTask.trim()) return;
    onAdd({ title: newTask.trim(), dueDate: today, completed: false, priority: 'Medium', assignedTo: 'emp-1' });
    setNewTask('');
  };

  const empName = (id) => employees?.find(e => e.id === id)?.name || '';

  return (
    <div>
      <div className={s.list}>
        {tasks.map(t => (
          <div key={t.id} className={s.item}>
            <button className={`${s.check} ${t.completed ? s.checked : ''}`} onClick={() => onToggle(t.id, { completed: !t.completed })}>
              {t.completed ? '✓' : ''}
            </button>
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
          </div>
        ))}
      </div>
      {onAdd && (
        <div className={s.addRow}>
          <input className={s.addInput} placeholder="Add a task..." value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          <button className="btn btn-primary btn-sm" onClick={handleAdd}>Add</button>
        </div>
      )}
    </div>
  );
}
