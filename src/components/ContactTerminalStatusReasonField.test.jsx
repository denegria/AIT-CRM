import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ContactTerminalStatusReasonField from './ContactTerminalStatusReasonField.jsx';

test('new AIT USA terminal status renders the outcome-reason contract field', () => {
  const html = renderToStaticMarkup(
    <ContactTerminalStatusReasonField visible value="Student declined" onChange={() => {}} />,
  );
  assert.match(html, /new-contact-terminal-reason/);
  assert.match(html, /Outcome reason/);
  assert.match(html, /Student declined/);
});

test('non-terminal and non-AIT workflows do not render the terminal reason field', () => {
  assert.equal(renderToStaticMarkup(
    <ContactTerminalStatusReasonField visible={false} value="" onChange={() => {}} />,
  ), '');
});
