'use client';

import { useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  CheckSquare,
  ClipboardCheck,
  Mail,
  MessageSquare,
  Phone,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';
import s from './ContactDetail.module.css';

function normalized(value = '') {
  return String(value || '').trim().toLowerCase();
}

function outreachIcon(item) {
  const channel = normalized(item.metadataJson?.channel || item.metadataJson?.contactMethod);
  if (channel.includes('phone') || channel.includes('call')) return <Phone size={16} />;
  if (channel.includes('email')) return <Mail size={16} />;
  if (channel.includes('person')) return <Users size={16} />;
  if (channel.includes('sms') || channel.includes('text') || channel.includes('whatsapp')) return <MessageSquare size={16} />;
  return <ClipboardCheck size={16} />;
}

function recordIcon(item) {
  const template = item.presentation?.template;
  if (template === 'outreach') return outreachIcon(item);
  if (template === 'inquiry') {
    return item.leadStatus ? <ArrowRightLeft size={16} /> : <UserPlus size={16} />;
  }
  if (template === 'note') return <MessageSquare size={16} />;
  if (template === 'task') return <CheckSquare size={16} />;
  if (template === 'system') return <Workflow size={16} />;
  return <Archive size={16} />;
}

function recordSummary(item) {
  const template = item.presentation?.template;
  if (template === 'outreach') {
    if (item.metadataJson?.note) return item.metadataJson.note;
    if (item.metadataJson?.outcome && /^follow-up completed:/i.test(String(item.text || ''))) return '';
  }
  return item.text || '';
}

function statusRepeatsTitle(status, title) {
  const normalizedStatus = normalized(status);
  const normalizedTitle = normalized(title);
  return Boolean(normalizedStatus && (
    normalizedStatus === normalizedTitle ||
    normalizedTitle.endsWith(` ${normalizedStatus}`)
  ));
}

export default function AitUsaActivityRecord({ item, dateParts, fullDateLabel }) {
  const [expanded, setExpanded] = useState(false);
  const presentation = item.presentation || {};
  const provenance = presentation.provenance;
  const title = presentation.title || item.title || presentation.categoryLabel || 'Activity';
  const summary = recordSummary(item);
  const status = presentation.statusLabel || '';
  const meta = Array.isArray(presentation.meta) ? presentation.meta.filter(Boolean).slice(0, 4) : [];
  const isLongNote = presentation.template === 'note' && summary.length > 280;
  const isLongOutreach = presentation.template === 'outreach' && summary.length > 220;
  const isCollapsible = isLongNote || isLongOutreach;
  const icon = recordIcon(item);
  const showStatus = status && !statusRepeatsTitle(status, title);

  return (
    <article
      className={`${s.timelineItem} ${s.aitUsaActivityItem} ${s[`activityTemplate_${presentation.template || 'activity'}`] || ''}`}
      aria-label={`${presentation.categoryLabel || 'Activity'}: ${title}`}
    >
      <div className={s.timelineIcon} aria-hidden="true">{icon}</div>
      <div className={`${s.timelineBody} ${s.aitUsaActivityBody}`}>
        <div className={s.timelineMeta}>
          <div className={s.timelineTypeGroup}>
            <span className={s.timelineType}>{presentation.categoryLabel || 'Activity'}</span>
            {showStatus && <span className={s.activityStatus}>{status}</span>}
            {presentation.isImported && <span className={s.activityImported}>Imported</span>}
          </div>
          <time
            className={s.timelineDateStack}
            dateTime={item.timestamp || item.date || undefined}
            title={fullDateLabel}
          >
            <span>{dateParts.date}</span>
            {dateParts.time && <strong>{dateParts.time}</strong>}
          </time>
        </div>

        <div className={s.timelineTitle}>{title}</div>

        {summary && (
          <div className={`${s.timelineText} ${isCollapsible && !expanded ? s.activityTextCollapsed : ''} ${isLongOutreach && !expanded ? s.activityOutreachCollapsed : ''}`}>
            {summary}
          </div>
        )}
        {isCollapsible && (
          <button
            className={s.activityExpand}
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}

        {meta.length > 0 && (
          <div className={s.activityMeta} aria-label="Activity details">
            {meta.map((detail) => <span key={`${item.id}-${detail}`}>{detail}</span>)}
          </div>
        )}

        {provenance && (
          <details className={`${s.timelineProvenance} ${s.activityProvenance}`}>
            <summary>Source details</summary>
            <div>
              {provenance.sourceKind && <span>{provenance.sourceKind}</span>}
              {provenance.sourceLabel && (
                <span>{provenance.sourceLabel}{provenance.sourceRow ? ` row ${provenance.sourceRow}` : ''}</span>
              )}
              {provenance.eventType && <span>{provenance.eventType}</span>}
              {provenance.rawText && <pre className={s.timelineRawText}>{provenance.rawText}</pre>}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
