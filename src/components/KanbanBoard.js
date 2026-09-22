'use client';
import { useState } from 'react';
import {
  BriefcaseBusiness,
  CalendarCheck,
  GraduationCap,
  Mail,
  Phone,
  UserRound,
} from 'lucide-react';
import { contactDirectoryNextStep } from '@/lib/contact-directory-next-step.js';
import s from './KanbanBoard.module.css';

const DEFAULT_VISIBLE_CARDS = 24;
const COMPACT_VISIBLE_CARDS = 32;

function clean(value) {
  return String(value || '').trim();
}

function firstPresent(values = []) {
  return values.map(clean).find(Boolean) || '';
}

function normalized(value = '') {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

const FIRST_OUTREACH_ACTION =
  'Make first outreach by phone/SMS/email; confirm program interest and schedule follow-up.';

function isDefaultFirstOutreachAction(value = '') {
  return normalized(value) === normalized(FIRST_OUTREACH_ACTION);
}

function isAitUsa(item) {
  return item.workflowKey === 'ait_usa';
}

function isAitSigns(item) {
  return item.workflowKey === 'ait_signs';
}

function noisyImportedComment(value = '') {
  const text = clean(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/(source file|merged row|workflow:|tags?:|source row|wix source|wix contacts export)/i.test(text)) return true;
  const dotParts = text.split(' · ').filter(Boolean);
  return dotParts.length >= 4 && (
    /\b(fb|ok|archive|work order|estimate|source)\b/i.test(text) ||
    /\d+\.\d+/.test(text)
  );
}

function sourceLabel(item) {
  if (isAitUsa(item)) {
    return firstPresent([
      item.enrollmentSignals?.source?.channel,
      item.inquirySource,
      item.source,
    ]);
  }
  if (isAitSigns(item)) return firstPresent([item.businessUnitName, item.workflowLabel, 'AIT Signs']);
  return item.source || item.workflowLabel || 'Pipeline';
}

function enrollmentLine(item) {
  const inquiry = item.enrollmentSignals?.inquiry || {};
  return [
    inquiry.programInterest || item.programInterest,
    inquiry.age ? `Age ${inquiry.age}` : '',
    inquiry.location,
  ].filter(Boolean).join(' · ');
}

function cardSummary(item) {
  if (isAitUsa(item)) {
    if (item.enrollmentSignals?.contactability?.canFollowUp === false) {
      return item.enrollmentSignals.contactability.reason || 'Needs contact information before outreach.';
    }
    const channel = item.enrollmentSignals?.source?.channel || item.inquirySource;
    return firstPresent([
      isDefaultFirstOutreachAction(item.enrollmentSignals?.process?.nextAction) ? '' : item.enrollmentSignals?.process?.nextAction,
      isDefaultFirstOutreachAction(item.nextAction) ? '' : item.nextAction,
      channel ? `New enrollment inquiry from ${channel}.` : '',
      'Enrollment lead ready for review.',
    ]);
  }
  if (isAitSigns(item)) {
    if (!noisyImportedComment(item.latestComment)) return item.latestComment;
    return firstPresent([
      item.latestCommentLabel ? `${item.latestCommentLabel} available in history.` : '',
      item.operationalSummary,
      item.nextAction,
      'Open contact for source details.',
    ]);
  }
  return noisyImportedComment(item.latestComment) ? 'Open contact for source details.' : (item.latestComment || 'No latest comment yet');
}

function pipelineNextStep(item) {
  const actionLabel = item.needsFirstContact || item.needsFirstOutreach
    ? 'Start outreach'
    : item.needsNextFollowUp
      ? 'Record follow-up'
      : '';
  const model = isAitUsa(item)
    ? (item.directoryNextStepModel || contactDirectoryNextStep(item))
    : {
        label: firstPresent([item.nextAction, item.operationalSummary, 'Review contact']),
        detail: '',
        action: actionLabel ? 'log_follow_up' : 'none',
        actionLabel,
      };
  if (model.label === 'No active work' && normalized(item.status) === 'enrolled') {
    return { ...model, label: 'No follow-up due', detail: '' };
  }
  return model;
}

function usefulNextStepDetail(item, nextStep) {
  const nextAction = firstPresent([
    item.enrollmentSignals?.process?.nextAction,
    item.nextAction,
  ]);
  if (
    nextAction &&
    !isDefaultFirstOutreachAction(nextAction) &&
    normalized(nextAction) !== normalized(nextStep.label)
  ) {
    return nextAction;
  }
  const redundantDetails = new Set([
    'no outreach recorded',
    'outreach may be recorded now',
    'record the next outreach',
    normalized(item.status),
  ]);
  if (nextStep.detail && !redundantDetails.has(normalized(nextStep.detail))) {
    return nextStep.detail;
  }
  if (isAitSigns(item)) return cardSummary(item);
  return '';
}

export default function KanbanBoard({
  data,
  columns,
  onMove,
  onEdit,
  onLogFollowUp,
  showMobileMoveControls = true,
  compact = false,
  fitColumns = false,
  selectedIds = [],
  onSelect,
}) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [visibleCardCounts, setVisibleCardCounts] = useState({});
  const selectedSet = new Set(selectedIds);
  const pageSize = compact ? COMPACT_VISIBLE_CARDS : DEFAULT_VISIBLE_CARDS;

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

  const moveCard = (event, item) => {
    event.stopPropagation();
    const nextColumn = normalizedColumns.find((column) => column.id === event.target.value);
    if (!nextColumn || nextColumn.id === item.status) return;
    if (onMove) onMove(item.id, nextColumn.id, nextColumn);
  };

  return (
    <div
      className={`${s.kanbanContainer} ${compact ? s.compact : ''} ${fitColumns ? s.fitColumns : ''}`}
      style={fitColumns ? { '--kanban-column-count': String(normalizedColumns.length) } : undefined}
    >
      {normalizedColumns.map(col => {
        const columnCards = data.filter(d => d.status === col.id);
        const visibleCount = Math.max(pageSize, visibleCardCounts[col.id] || 0);
        const visibleCards = columnCards.slice(0, visibleCount);
        const remainingCount = Math.max(0, columnCards.length - visibleCards.length);
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
            
            <div className={s.kanbanList} data-kanban-list={col.id}>
              {visibleCards.map(item => {
                const nextStep = pipelineNextStep(item);
                const nextStepDetail = usefulNextStepDetail(item, nextStep);
                return (
                  <div
                    key={item.id}
                    className={`${s.kanbanCard} ${isAitUsa(item) ? s.instituteCard : ''} ${isAitSigns(item) ? s.signsCard : ''} ${item.needsFirstOutreach ? s.needsFirstOutreach : ''} ${draggingId === item.id ? s.dragging : ''}`}
                    data-kanban-card={col.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, item.id)}
                    onClick={() => onEdit && onEdit(item)}
                  >
                    <div className={s.cardTop}>
                      <div className={s.cardIdentity}>
                        <div className={s.cardName}>{item.name}</div>
                        <span className={s.cardSource}>{sourceLabel(item)}</span>
                      </div>
                      {onSelect && (
                        <input
                          type="checkbox"
                          className={s.cardSelect}
                          checked={selectedSet.has(item.id)}
                          onChange={(event) => {
                            event.stopPropagation();
                            const next = new Set(selectedSet);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            onSelect([...next]);
                          }}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select ${item.name}`}
                        />
                      )}
                    </div>
                    {isAitUsa(item) && enrollmentLine(item) && (
                      <div className={s.cardSubline}>
                        <GraduationCap size={12} />
                        <span>{enrollmentLine(item)}</span>
                      </div>
                    )}
                    {isAitSigns(item) && item.operationalSummary && (
                      <div className={s.cardSubline}>
                        <BriefcaseBusiness size={12} />
                        <span>{item.operationalSummary}</span>
                      </div>
                    )}
                    <div className={s.cardNextStep}>
                      <span className={s.nextStepEyebrow}>Next step</span>
                      <strong>{nextStep.label}</strong>
                      {nextStepDetail && <span className={s.nextStepDetail}>{nextStepDetail}</span>}
                    </div>
                    <div className={s.cardMeta}>
                      <div className={s.metaItem}>
                        {item.phone ? <Phone size={12} /> : <Mail size={12} />}
                        <span>{item.phone || item.email || 'No contact channel'}</span>
                      </div>
                      <div className={s.metaItem}><CalendarCheck size={12} /> <span>{item.lastTouch || item.lastContact || 'No touch recorded'}</span></div>
                    </div>
                    <div className={s.cardFooter}>
                      <div className={s.cardUser}>
                        <div className={s.userAvatar}>{item.assignedLabel?.charAt(0) || <UserRound size={11} />}</div>
                        <span>{item.assignedLabel || 'Unassigned'}</span>
                      </div>
                      <div className={s.cardActions}>
                        {onMove && !showMobileMoveControls && (
                          <label className={s.cardMoveDesktop} onClick={(event) => event.stopPropagation()}>
                            <span className={s.visuallyHidden}>Move {item.name} to another stage</span>
                            <select value="" onChange={(event) => moveCard(event, item)} aria-label={`Move ${item.name} to another stage`}>
                              <option value="" disabled>Move…</option>
                              {normalizedColumns.filter((column) => column.id !== item.status).map((column) => (
                                <option key={column.id} value={column.id}>{column.label}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {onLogFollowUp && nextStep.action === 'log_follow_up' && (
                          <button
                            className={s.cardFollowUpAction}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onLogFollowUp(item);
                            }}
                          >
                            {nextStep.actionLabel || 'Record outreach'}
                          </button>
                        )}
                      </div>
                    </div>
                    {onMove && showMobileMoveControls && (
                      <label className={s.cardMove} onClick={(event) => event.stopPropagation()}>
                        <span>Move to</span>
                        <select value={item.status} onChange={(event) => moveCard(event, item)}>
                          {normalizedColumns.map((column) => (
                            <option key={column.id} value={column.id}>{column.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
              {remainingCount > 0 && (
                <button
                  className={s.loadMore}
                  type="button"
                  onClick={() => setVisibleCardCounts((current) => ({
                    ...current,
                    [col.id]: visibleCards.length + pageSize,
                  }))}
                >
                  Show {Math.min(pageSize, remainingCount)} more
                  <span>{remainingCount.toLocaleString()} remaining</span>
                </button>
              )}
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
