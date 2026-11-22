import { expect, it } from 'vitest';
import {
  createDocumentTypeInput,
  employeeDocument,
  employeeDocumentFormInput,
  employeeDocumentListItem,
  employeeDocumentNumbers,
  employeeDocumentNumbersQuery,
  recordEmployeeDocumentInput,
  updateDocumentTypeInput,
} from '../staff/employee-documents.js';

const uuid = (suffix: string) => `01920000-0000-7000-8000-0000000000${suffix}`.toLowerCase();

const terms = { name_en: ' Civil ID ', alert_days: 30, requires_expiry: true };
const fileId = '01920000-0000-7000-8000-0000000000aa';

it('trims type names and bounds alert days, rejecting unknown claims such as a client code', () => {
  expect(createDocumentTypeInput.parse(terms).name_en).toBe('Civil ID');
  expect(createDocumentTypeInput.parse({ ...terms, alert_days: 0 }).alert_days).toBe(0);
  for (const input of [
    { ...terms, alert_days: -1 },
    { ...terms, alert_days: 366 },
    { ...terms, alert_days: 1.5 },
    { ...terms, name_en: '  ' },
    { ...terms, name_ar: '' },
    { ...terms, code: 'civil_id' },
    { ...terms, active: false },
  ])
    expect(createDocumentTypeInput.safeParse(input).success).toBe(false);
  expect(updateDocumentTypeInput.safeParse({ ...terms }).success).toBe(false);
  expect(updateDocumentTypeInput.parse({ ...terms, expected_revision: 2 }).expected_revision).toBe(
    2,
  );
});

it('records by file id only — an object key, a year zero or an impossible date is refused', () => {
  const input = { type_code: 'civil_id', file_id: fileId, expires_on: '2020-02-29' };
  expect(recordEmployeeDocumentInput.parse(input)).toEqual(input);
  expect(recordEmployeeDocumentInput.parse({ ...input, expires_on: null }).expires_on).toBeNull();
  for (const bad of [
    { ...input, expires_on: '2021-02-29' },
    { ...input, expires_on: '0000-01-01' },
    { ...input, object_key: 'company/business/key' },
    { ...input, type_code: 'Civil ID' },
    { type_code: 'civil_id', file_id: fileId },
  ])
    expect(recordEmployeeDocumentInput.safeParse(bad).success).toBe(false);
});

it('the admin form treats an empty expiry as "no date" and still refuses impossible dates', () => {
  expect(
    employeeDocumentFormInput.parse({ type_code: 'civil_id', expires_on: '' }).expires_on,
  ).toBe('');
  expect(
    employeeDocumentFormInput.safeParse({ type_code: 'civil_id', expires_on: '2026-02-30' })
      .success,
  ).toBe(false);
  expect(
    employeeDocumentFormInput.parse({ type_code: 'civil_id', expires_on: '', document_number: '' })
      .document_number,
  ).toBe('');
  expect(
    employeeDocumentFormInput.parse({
      type_code: 'civil_id',
      expires_on: '',
      document_number: '  A1234567  ',
    }).document_number,
  ).toBe('A1234567');
  expect(
    employeeDocumentFormInput.safeParse({
      type_code: 'civil_id',
      expires_on: '',
      document_number: 'A\u0007B',
    }).success,
  ).toBe(false);
  expect(
    employeeDocumentFormInput.safeParse({ type_code: 'civil_id', expires_on: '' }).success,
  ).toBe(true);
});

it('the record input treats omitted and null as no number and refuses blank, long and control values', () => {
  const base = { type_code: 'civil_id', file_id: fileId, expires_on: null };
  expect(recordEmployeeDocumentInput.parse(base).document_number).toBeUndefined();
  expect(
    recordEmployeeDocumentInput.parse({ ...base, document_number: null }).document_number,
  ).toBeNull();
  expect(
    recordEmployeeDocumentInput.parse({ ...base, document_number: '  A1234567  ' }).document_number,
  ).toBe('A1234567');
  expect(
    recordEmployeeDocumentInput.parse({ ...base, document_number: 'خ'.repeat(64) }).document_number,
  ).toBe('خ'.repeat(64));
  for (const bad of [
    '',
    '   ',
    'خ'.repeat(65),
    'A\u0007B',
    'A\u0081B',
    'A\u202eB',
    'A\u2066B',
    42,
  ]) {
    expect(recordEmployeeDocumentInput.safeParse({ ...base, document_number: bad }).success).toBe(
      false,
    );
  }
});

it('refuses isolated UTF-16 surrogates but keeps supplementary characters unchanged', () => {
  const base = { type_code: 'civil_id', file_id: fileId, expires_on: null };
  for (const document_number of ['A\ud800B', 'A\udfffB']) {
    expect(recordEmployeeDocumentInput.safeParse({ ...base, document_number }).success).toBe(false);
  }
  const document_number = 'A\u{1f4c4}B';
  expect(recordEmployeeDocumentInput.parse({ ...base, document_number }).document_number).toBe(
    document_number,
  );
});

it('the list item carries the number while the record response keeps none of it', () => {
  const number = 'SYN-DOC-0001';
  const document = {
    id: uuid('a1'),
    employee_id: uuid('a2'),
    type_code: 'civil_id',
    type_name_en: 'Civil ID',
    type_name_ar: null,
    object_key: 'company/business/key',
    expires_on: null,
    uploaded_by: uuid('a3'),
    recorded_at: '2026-11-21T00:00:00Z',
    status: 'NO_EXPIRY',
  };
  expect(employeeDocument.parse(document)).not.toHaveProperty('document_number');
  expect(employeeDocumentListItem.parse({ ...document, document_number: number })).toMatchObject({
    document_number: number,
  });
  expect(employeeDocumentListItem.parse({ ...document, document_number: null })).toMatchObject({
    document_number: null,
  });
  expect(employeeDocumentListItem.safeParse({ ...document, document_number: '  ' }).success).toBe(
    false,
  );
});

it('the numbers query bounds the id set and canonicalizes uuid case', () => {
  const first = uuid('b1');
  const second = uuid('B2');
  expect(employeeDocumentNumbersQuery.parse({ ids: first.toUpperCase() })).toEqual({
    ids: [first],
  });
  expect(employeeDocumentNumbersQuery.parse({ ids: `${first},${second}` })).toEqual({
    ids: [first, second],
  });
  for (const bad of [
    '',
    `${first},`,
    `${first},${first}`,
    Array.from({ length: 21 }, () => first).join(','),
    `${first},not-a-uuid`,
  ]) {
    expect(employeeDocumentNumbersQuery.safeParse({ ids: bad }).success).toBe(false);
  }
  expect(employeeDocumentNumbersQuery.safeParse({ ids: [first] }).success).toBe(false);
  expect(
    employeeDocumentNumbers.safeParse({
      items: [{ document_id: first, document_number: 'SYN-DOC-0001' }],
    }).success,
  ).toBe(true);
  expect(employeeDocumentNumbers.safeParse({ items: [] }).success).toBe(true);
  expect(employeeDocumentNumbers.safeParse({ items: [{ document_id: first }] }).success).toBe(
    false,
  );
});
