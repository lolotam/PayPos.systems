import { expect, it } from 'vitest';

import * as documents from '../index.ts';
import { html } from '../html/template.ts';

const PAYLOAD = `<script>alert("x")</script> 'q' & </style>`;

it('C1 escapes script, quotes, ampersand and a style close tag', () => {
  const page = html`<p>${PAYLOAD}</p>`;
  expect(page.value).toContain('&lt;script&gt;');
  expect(page.value).toContain('&quot;');
  expect(page.value).toContain('&#39;');
  expect(page.value).toContain('&amp;');
  expect(page.value).toContain('&lt;/style&gt;');
  expect(page.value).not.toContain('<script>');
  expect(page.value).not.toContain('</style>');
});

it('C1 does not treat request-shaped objects as raw HTML', () => {
  expect(documents).not.toHaveProperty('raw');
  expect(documents).not.toHaveProperty('htmlFragmentBrand');
  const forged: { value: string } = { value: '<script>alert(1)</script>' };
  const page = html`<div>${forged}</div>`;
  expect(page.value).toContain('&lt;script&gt;');
  expect(page.value).not.toContain('<script>');
  const trusted = html`<b>${'ok'}</b>`;
  const mixed = html`<section>${[trusted, PAYLOAD]}</section>`;
  expect(mixed.value).toContain('<b>ok</b>');
  expect(mixed.value).toContain('&lt;script&gt;');
});
