import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';
import ContactMetricHelp from './ContactMetricHelp.jsx';

async function fixture(run) {
  const dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>', { url:'http://localhost' });
  const keys = ['window','document','IS_REACT_ACT_ENVIRONMENT'];
  const descriptors = Object.fromEntries(keys.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperty(globalThis,'window',{value:dom.window,configurable:true,writable:true});
  Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true,writable:true});
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true,writable:true});
  const root = createRoot(document.getElementById('root'));
  try {
    await act(() => root.render(<ContactMetricHelp label="Recorded contact rate" />));
    const button = document.querySelector('.reports-metric-help-trigger');
    const outside = document.getElementById('outside');
    const tooltip = () => document.querySelector('[role="tooltip"]');
    const enter = () => button.dispatchEvent(new window.MouseEvent('mouseover',{bubbles:true,relatedTarget:outside}));
    const leave = () => button.dispatchEvent(new window.MouseEvent('mouseout',{bubbles:true,relatedTarget:outside}));
    await run({button,outside,tooltip,enter,leave});
  } finally {
    await act(() => root.unmount());
    dom.window.close();
    for (const key of keys) {
      if (descriptors[key]) Object.defineProperty(globalThis,key,descriptors[key]);
      else delete globalThis[key];
    }
  }
}

test('focused/tapped help survives compatibility mouse exit and dismisses outside', async () => fixture(async ({button,outside,tooltip,leave}) => {
  await act(() => { button.focus(); button.click(); });
  assert.ok(tooltip());
  await act(leave);
  assert.equal(document.activeElement,button);
  assert.ok(tooltip(),'Synthetic touch mouseout must not dismiss focused help');
  await act(() => outside.dispatchEvent(new window.Event('pointerdown',{bubbles:true})));
  assert.equal(tooltip(),null);
}));

test('unfocused hover still opens and dismisses on pointer exit', async () => fixture(async ({tooltip,enter,leave}) => {
  await act(enter);
  assert.ok(tooltip());
  await act(leave);
  assert.equal(tooltip(),null);
}));

test('keyboard focus exposes linked help and Escape dismisses it', async () => fixture(async ({button,tooltip}) => {
  await act(() => button.focus());
  assert.equal(button.getAttribute('aria-describedby'),tooltip().id);
  await act(() => button.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(tooltip(),null);
  assert.equal(button.hasAttribute('aria-describedby'),false);
}));

test('moving focus outside dismisses focused help', async () => fixture(async ({button,outside,tooltip}) => {
  await act(() => button.focus());
  assert.ok(tooltip());
  await act(() => outside.focus());
  assert.equal(tooltip(),null);
}));
