'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  FileQuestion,
  LoaderCircle,
  LockKeyhole,
  SearchX,
} from 'lucide-react';

const ICONS = {
  denied: LockKeyhole,
  empty: FileQuestion,
  error: AlertTriangle,
  loading: LoaderCircle,
  'not-found': SearchX,
};

export default function PageState({
  title,
  children,
  copy,
  actions,
  className = '',
  size = 'default',
  tone = 'empty',
}) {
  const Icon = ICONS[tone] || ICONS.empty;
  const classes = ['empty-state', 'page-state', `page-state-${tone}`, size === 'compact' ? 'page-state-compact' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes} aria-live={tone === 'loading' ? 'polite' : undefined}>
      <div className="page-state-icon" aria-hidden="true">
        <Icon size={22} className={tone === 'loading' ? 'page-state-spinner' : ''} />
      </div>
      {title && <div className="empty-state-title">{title}</div>}
      {(copy || children) && (
        <p className="empty-state-copy">
          {copy || children}
        </p>
      )}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </section>
  );
}

export function PageStateAction({ href, children, variant = 'primary', ...props }) {
  const className = `btn btn-sm ${variant === 'primary' ? 'btn-primary' : ''}`.trim();
  if (href) {
    return (
      <Link className={className} href={href} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} {...props}>
      {children}
    </button>
  );
}
