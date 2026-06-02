'use client';
import { useState } from 'react';
import { AlertCircle, MoreHorizontal, Calendar, Phone } from 'lucide-react';
import s from './KanbanBoard.module.css';

export default function KanbanBoard({ data, columns, onMove, onEdit }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const normalizedColumns = columns.map((column) => {
    if (typeof column === 'string') {
      return {
        id: column,
        label: column,
        isTerminal: column === 'Won' || column === 'Lost',
        isOperational: false,
      };
    }
    return {
      id: column.id || column.status || column.label,
      label: column.label || column.id || column.status,
      isTerminal: Boolean(column.isTerminal),
      isOperational: Boolean(column.isOperational),
    };
  });

  const onDragStart = (e, id) => {
    setDraggingId(id);
    e.dataTransfer.setData('id', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDragEnter = (e, col) => {
    e.preventDefault();
    setDragOverCol(col.id);
  };

  const onDragLeave = (e) => {
    // Only clear if leaving the column (not entering a child element)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverCol(null);
    }
  };

  const onDrop = (e, column) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('id');
    if (onMove) onMove(id, column.id, column);
    setDraggingId(null);
    setDragOverCol(null);
  };

  return (
    <div className={s.kanbanContainer}>
      {normalizedColumns.map(col => {
        const columnCards = data.filter(d => d.status === col.id);
        return (
          <div 
            key={col.id}
            className={`${s.kanbanColumn} ${col.isTerminal ? s.terminal : ''} ${col.isOperational ? s.operational : ''} ${draggingId && dragOverCol === col.id ? s.dragOver : ''}`}
            onDragOver={onDragOver}
            onDragEnter={(e) => onDragEnter(e, col)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, col)}
          >
            <div className={s.kanbanHeader}>
              <span className={s.kanbanTitle}>{col.label}</span>
              <span className={s.kanbanCount}>{columnCards.length}</span>
            </div>
            
            <div className={s.kanbanList}>
              {columnCards.map(item => (
                <div 
                  key={item.id} 
                  className={`${s.kanbanCard} ${item.needsFirstOutreach ? s.needsFirstOutreach : ''} ${draggingId === item.id ? s.dragging : ''}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.id)}
                  onClick={() => onEdit && onEdit(item)}
                >
                  <div className={s.cardTop}>
                    <span className={s.cardSource}>{item.source}</span>
                    <button className={s.cardMore}><MoreHorizontal size={14} /></button>
                  </div>
                  <div className={s.cardName}>{item.name}</div>
                  {(item.currentStage || item.nextAction) && (
                    <div className={s.cardWorkflow}>
                      <div className={s.workflowStage}>
                        {item.needsFirstOutreach && <AlertCircle size={12} />}
                        <span>{item.currentStage || item.status}</span>
                      </div>
                      {item.nextAction && <div className={s.workflowAction}>{item.nextAction}</div>}
                    </div>
                  )}
                  <div className={s.cardMeta}>
                    <div className={s.metaItem}><Phone size={12} /> <span>{item.phone}</span></div>
                    <div className={s.metaItem}><Calendar size={12} /> <span>{item.lastContact}</span></div>
                  </div>
                  <div className={s.cardFooter}>
                    <div className={s.cardUser}>
                      <div className={s.userAvatar}>{item.assignedLabel?.charAt(0) || 'U'}</div>
                      <span>{item.assignedLabel || 'Unassigned'}</span>
                    </div>
                    {!!item.tags?.length && <span className={s.cardTag}>{item.tags[0].replaceAll('_', ' ')}</span>}
                  </div>
                </div>
              ))}
              {columnCards.length === 0 && (
                <div className={s.kanbanEmpty}>{col.isOperational ? 'Driven by linked records' : 'Drop here'}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
