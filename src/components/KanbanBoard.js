'use client';
import { useState } from 'react';
import { MoreHorizontal, User, Calendar, Phone } from 'lucide-react';

export default function KanbanBoard({ data, columns, onMove, onEdit }) {
  const [draggingId, setDraggingId] = useState(null);

  const onDragStart = (e, id) => {
    setDraggingId(id);
    e.dataTransfer.setData('id', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (e, status) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('id');
    if (onMove) onMove(id, status);
    setDraggingId(null);
  };

  return (
    <div className="kanban-container">
      {columns.map(col => (
        <div 
          key={col} 
          className="kanban-column"
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, col)}
        >
          <div className="kanban-header">
            <span className="kanban-title">{col}</span>
            <span className="kanban-count">{data.filter(d => d.status === col).length}</span>
          </div>
          
          <div className="kanban-list">
            {data.filter(d => d.status === col).map(item => (
              <div 
                key={item.id} 
                className={`kanban-card ${draggingId === item.id ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => onDragStart(e, item.id)}
                onClick={() => onEdit && onEdit(item)}
              >
                <div className="card-top">
                  <span className="card-source">{item.source}</span>
                  <button className="card-more"><MoreHorizontal size={14} /></button>
                </div>
                <div className="card-name">{item.name}</div>
                <div className="card-meta">
                  <div className="meta-item"><Phone size={12} /> <span>{item.phone}</span></div>
                  <div className="meta-item"><Calendar size={12} /> <span>{item.lastContact}</span></div>
                </div>
                <div className="card-footer">
                  <div className="card-user">
                    <div className="user-avatar">{item.assignedLabel?.charAt(0) || 'U'}</div>
                    <span>{item.assignedLabel}</span>
                  </div>
                </div>
              </div>
            ))}
            {data.filter(d => d.status === col).length === 0 && (
              <div className="kanban-empty">Drop here</div>
            )}
          </div>
        </div>
      ))}
      
      <style jsx>{`
        .kanban-container {
          display: flex;
          gap: 16px;
          overflow-x: auto;
          padding-bottom: 16px;
          min-height: 600px;
        }
        .kanban-column {
          flex: 0 0 280px;
          background: var(--bg-tertiary);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-subtle);
        }
        .kanban-header {
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-subtle);
        }
        .kanban-title {
          font-weight: 600;
          font-size: var(--text-sm);
          color: var(--text-primary);
        }
        .kanban-count {
          font-size: var(--text-xs);
          background: var(--bg-secondary);
          color: var(--text-muted);
          padding: 2px 8px;
          border-radius: 10px;
          border: 1px solid var(--border-subtle);
        }
        .kanban-list {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex: 1;
        }
        .kanban-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px;
          cursor: grab;
          box-shadow: var(--shadow-sm);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .kanban-card:hover {
          box-shadow: var(--shadow-md);
          border-color: var(--accent);
        }
        .kanban-card:active { cursor: grabbing; }
        .kanban-card.dragging { opacity: 0.5; transform: scale(0.95); }
        
        .card-top {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .card-source {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 700;
        }
        .card-more {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }
        .card-name {
          font-weight: 600;
          font-size: var(--text-sm);
          color: var(--text-primary);
          margin-bottom: 12px;
        }
        .card-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 12px;
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: var(--text-xs);
          color: var(--text-secondary);
        }
        .card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 8px;
          border-top: 1px solid var(--border-subtle);
        }
        .card-user {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: var(--text-secondary);
        }
        .user-avatar {
          width: 20px;
          height: 20px;
          background: var(--accent-muted);
          color: var(--accent);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 10px;
        }
        .kanban-empty {
          height: 60px;
          border: 2px dashed var(--border-subtle);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: var(--text-xs);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
