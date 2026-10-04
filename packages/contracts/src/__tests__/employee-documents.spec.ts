import { expect, it } from 'vitest';
import {
  createDocumentTypeInput,
  employeeDocumentFormInput,
  recordEmployeeDocumentInput,
  updateDocumentTypeInput,
} from '../staff/employee-documents.js';

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
});
