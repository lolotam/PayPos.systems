import { expect, it } from 'vitest';
import {
  documentExpiryRecipients,
  documentExpiringParameters,
} from '../document-expiry-notice.ts';

const DOCUMENT = '01920000-0000-7000-8000-0000000000d1';

it('gives every holder the bell when the rule names no role', () => {
  expect(documentExpiryRecipients([], ['c1'], ['h2', 'h1'])).toEqual(['h1', 'h2']);
});

it('gives the bell to the candidates who hold the permission', () => {
  expect(documentExpiryRecipients(['branch_manager'], ['c1', 'c2'], ['c1', 'h1'])).toEqual(['c1']);
});

it('drops a candidate without the permission', () => {
  expect(documentExpiryRecipients(['branch_manager'], ['c1'], ['h1'])).toEqual([]);
});

it('drops a holder outside the chosen roles', () => {
  expect(documentExpiryRecipients(['branch_manager'], ['c1'], ['c1', 'h1'])).toEqual(['c1']);
});

it('collapses duplicates and sorts the recipients', () => {
  expect(documentExpiryRecipients([], [], ['h2', 'h1', 'h2'])).toEqual(['h1', 'h2']);
  expect(documentExpiryRecipients(['branch_manager'], ['c1', 'c1'], ['c1', 'c1'])).toEqual(['c1']);
});

it('builds the bell parameters in the template order', () => {
  expect(
    documentExpiringParameters('سارة', 'Sara', 'إقامة', 'Residency', '2026-11-04', DOCUMENT),
  ).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'سارة' },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'document_type_ar', type: 'text', value: 'إقامة' },
    { name: 'document_type_en', type: 'text', value: 'Residency' },
    { name: 'expires_on', type: 'text', value: '2026-11-04' },
    { name: 'document_id', type: 'text', value: DOCUMENT },
  ]);
});

it('falls back to the English names and to the generic document name', () => {
  expect(
    documentExpiringParameters('', 'Sara', null, 'Residency', '2026-11-04', DOCUMENT)?.[0],
  ).toEqual({ name: 'employee_name_ar', type: 'text', value: 'Sara' });
  expect(
    documentExpiringParameters(null, 'Sara', null, '123456', '2026-11-04', DOCUMENT)?.[2],
  ).toEqual({ name: 'document_type_ar', type: 'text', value: 'Document' });
});

it('gives no parameters for a date or a document id outside their format', () => {
  expect(
    documentExpiringParameters(null, 'Sara', null, 'Residency', '04-11-2026', DOCUMENT),
  ).toBeNull();
  expect(
    documentExpiringParameters(null, 'Sara', null, 'Residency', '2026-02-30', DOCUMENT),
  ).toBeNull();
  expect(
    documentExpiringParameters(null, 'Sara', null, 'Residency', '2026-11-04', 'not-a-uuid'),
  ).toBeNull();
  expect(
    documentExpiringParameters(null, 'Sara', null, 'Residency', '2026-11-04', DOCUMENT.toUpperCase()),
  ).toBeNull();
});
