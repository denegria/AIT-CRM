import React from 'react';

export default function OpportunityLifecycleField({
  isAitUsa,
  hasLeadStatus,
  opportunityConflict = false,
  status,
  statuses = [],
  onStatusChange,
  onStart,
}) {
  if (isAitUsa && opportunityConflict) {
    return (
      <div className="profile-editor-opportunity-empty" data-testid="opportunity-conflict-state">
        <div className="profile-editor-helper" role="alert">
          Multiple active Opportunities were found. Status and owner changes are blocked until the conflict is resolved.
        </div>
      </div>
    );
  }
  if (isAitUsa && !hasLeadStatus) {
    return (
      <div className="profile-editor-opportunity-empty" data-testid="opportunity-empty-state">
        <div className="profile-editor-helper">
          This Contact does not have an Opportunity yet. Start one before setting an enrollment lifecycle status.
        </div>
        <button className="btn" type="button" onClick={onStart}>Start opportunity</button>
      </div>
    );
  }

  return (
    <select
      id="profile-edit-status"
      className="input select"
      value={status}
      onChange={onStatusChange}
      data-testid="opportunity-status-selector"
    >
      {[...new Set([...(statuses || []), ...(status ? [status] : [])])]
        .map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  );
}
