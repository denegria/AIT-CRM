'use client';
import { useState } from 'react';
import { MoreHorizontal, Calendar, Phone } from 'lucide-react';
import s from './KanbanBoard.module.css';

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
    <div className={s.kanbanContainer}>
      {columns.map(col => {
        const isTerminal = col === 'Won' || col === 'Lost';
        return (
          <div 
            key={col} 
            className={`${s.kanbanColumn} ${isTerminal ? s.terminal : ''}`}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, col)}
          >
            <div className={s.kanbanHeader}>
              <span className={s.kanbanTitle}>{col}</span>
              <span className={s.kanbanCount}>{data.filter(d => d.status === col).length}</span>
            </div>
            
            <div className={s.kanbanList}>
              {data.filter(d => d.status === col).map(item => (
                <div 
                  key={item.id} 
                  className={`${s.kanbanCard} ${draggingId === item.id ? s.dragging : ''}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.id)}
                  onClick={() => onEdit && onEdit(item)}
                >
                  <div className={s.cardTop}>
                    <span className={s.cardSource}>{item.source}</span>
                    <button className={s.cardMore}><MoreHorizontal size={14} /></button>
                  </div>
                  <div className={s.cardName}>{item.name}</div>
                  <div className={s.cardMeta}>
                    <div className={s.metaItem}><Phone size={12} /> <span>{item.phone}</span></div>
                    <div className={s.metaItem}><Calendar size={12} /> <span>{item.lastContact}</span></div>
                  </div>
                  <div className={s.cardFooter}>
                    <div className={s.cardUser}>
                      <div className={s.userAvatar}>{item.assignedLabel?.charAt(0) || 'U'}</div>
                      <span>{item.assignedLabel}</span>
                    </div>
                  </div>
                </div>
              ))}
              {data.filter(d => d.status === col).length === 0 && (
                <div className={s.kanbanEmpty}>Drop here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
