import React from 'react';

export default function ContactTerminalStatusReasonField({ visible, value = '', onChange }) {
  if (!visible) return null;
  return (
    <div className="form-group" data-testid="new-contact-terminal-reason">
      <label className="form-label" htmlFor="contact-dialog-terminal-reason">Outcome reason</label>
      <textarea
        id="contact-dialog-terminal-reason"
        className="textarea"
        rows={2}
        value={value}
        placeholder="Explain why this Opportunity starts in a closed status"
        onChange={onChange}
      />
    </div>
  );
}
