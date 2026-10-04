import { describe, expect, it } from 'vitest';
import type { DocumentTypeRecord } from '../document-types.ts';
import {
  documentStatus,
  documentToday,
  documentView,
  replaceCurrentDocument,
  requireDocumentFile,
  validateDocumentRecord,
  type DocumentFileFacts,
  type EmployeeDocumentRecord,
} from '../employee-documents.ts';

const businessId = '01920000-0000-7000-8000-0000000000b1';
const employeeId = '01920000-0000-7000-8000-0000000000e1';
const userId = '01920000-0000-7000-8000-0000000000c1';
const expected = { businessId, employeeId, userId };
const file: DocumentFileFacts = {
  business_id: businessId,
  branch_id: null,
  owner_module: 'staff',
  owner_entity_id: employeeId,
  required_permission: 'read:files:business',
  created_by: userId,
  status: 'READY',
  storage_key: 'company/business/verified-key',
  purged: false,
};
const type: DocumentTypeRecord = {
  id: '01920000-0000-7000-8000-0000000000f1',
  code: 'passport',
  name_en: 'Passport',
  name_ar: null,
  alert_days: 30,
  requires_expiry: true,
  active: true,
  revision: 1,
};
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'NO_ERROR';
};

describe('requireDocumentFile', () => {
  it('returns the verified key of a READY file uploaded by the recorder for this employee', () => {
    expect(requireDocumentFile(file, expected)).toBe('company/business/verified-key');
  });
  it.each([
    ['missing', null],
    ['purged', { ...file, purged: true }],
    ['another module', { ...file, owner_module: 'customers' }],
    ['another employee', { ...file, owner_entity_id: businessId }],
    ['another business', { ...file, business_id: employeeId }],
    ['branch-scoped', { ...file, branch_id: businessId }],
    ['broader permission', { ...file, required_permission: 'manage:files:business' }],
    ['another uploader', { ...file, created_by: employeeId }],
  ])('treats a %s file as unknown', (_name, facts) => {
    expect(code(() => requireDocumentFile(facts, expected))).toBe('NOT_FOUND');
  });
  it.each(['PENDING', 'VERIFYING', 'REJECTED'] as const)(
    'refuses a matching %s file as not ready',
    (status) => {
      expect(
        code(() => requireDocumentFile({ ...file, status, storage_key: null }, expected)),
      ).toBe('FILE_NOT_READY');
    },
  );
  it('checks ownership before readiness so a foreign pending file stays unknown', () => {
    expect(
      code(() =>
        requireDocumentFile({ ...file, status: 'PENDING', created_by: employeeId }, expected),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('validateDocumentRecord', () => {
  it('accepts a past expiry and a missing one when the type does not require it', () => {
    expect(validateDocumentRecord(type, '2020-01-31')).toEqual({ type, expiresOn: '2020-01-31' });
    const optional = { ...type, requires_expiry: false };
    expect(validateDocumentRecord(optional, null).expiresOn).toBeNull();
    expect(validateDocumentRecord(optional, '2030-02-28').expiresOn).toBe('2030-02-28');
  });
  it('refuses unknown or inactive types, a missing required expiry and impossible dates', () => {
    expect(code(() => validateDocumentRecord(null, '2030-01-01'))).toBe(
      'DOCUMENT_TYPE_UNAVAILABLE',
    );
    expect(code(() => validateDocumentRecord({ ...type, active: false }, '2030-01-01'))).toBe(
      'DOCUMENT_TYPE_UNAVAILABLE',
    );
    expect(code(() => validateDocumentRecord(type, null))).toBe('DOCUMENT_EXPIRY_REQUIRED');
    for (const date of ['2031-02-29', '0000-01-01', '2030-1-01', '2030-13-01'])
      expect(code(() => validateDocumentRecord(type, date))).toBe('VALIDATION_FAILED');
  });
});

describe('replaceCurrentDocument', () => {
  const current: EmployeeDocumentRecord = {
    id: 'old',
    business_id: businessId,
    employee_id: employeeId,
    type_code: 'passport',
    object_key: 'old-key',
    expires_on: '2026-01-01',
    uploaded_by: userId,
    recorded_at: '2025-01-01T00:00:00.000Z',
    replaced_at: null,
  };
  const next = {
    ...current,
    id: 'new',
    object_key: 'new-key',
    recorded_at: '2026-10-04T08:00:00.000Z',
  };
  it('marks the current document replaced at the new recording time and keeps it', () => {
    expect(replaceCurrentDocument(current, next)).toEqual({
      replaced: { ...current, replaced_at: '2026-10-04T08:00:00.000Z' },
      recorded: next,
    });
    expect(replaceCurrentDocument(null, next)).toEqual({ replaced: null, recorded: next });
  });
  it('refuses to record the same file over itself', () => {
    expect(code(() => replaceCurrentDocument(current, { ...next, object_key: 'old-key' }))).toBe(
      'DOCUMENT_FILE_ALREADY_RECORDED',
    );
  });
});

describe('documentStatus', () => {
  it.each([
    [null, 30, '2026-10-04', 'NO_EXPIRY'],
    ['2026-10-03', 30, '2026-10-04', 'EXPIRED'],
    ['2020-01-01', 0, '2026-10-04', 'EXPIRED'],
    ['2026-10-04', 0, '2026-10-04', 'EXPIRING'],
    ['2026-10-05', 0, '2026-10-04', 'VALID'],
    ['2026-11-03', 30, '2026-10-04', 'EXPIRING'],
    ['2026-11-04', 30, '2026-10-04', 'VALID'],
    ['2027-10-04', 365, '2026-10-04', 'EXPIRING'],
    ['2028-03-01', 1, '2028-02-29', 'EXPIRING'],
  ] as const)('%s with %i alert days on %s is %s', (expiresOn, alertDays, today, status) => {
    expect(documentStatus(expiresOn, alertDays, today)).toBe(status);
  });
  it('refuses an impossible date instead of guessing', () => {
    expect(code(() => documentStatus('2026-02-30', 1, '2026-01-01'))).toBe('VALIDATION_FAILED');
  });
});

describe('documentToday', () => {
  it('uses the business timezone: 21:30 UTC is already the next day in Kuwait', () => {
    const at = new Date('2026-10-04T21:30:00Z');
    expect(documentToday(at, 'Asia/Kuwait')).toBe('2026-10-05');
    expect(documentToday(at, 'UTC')).toBe('2026-10-04');
    expect(documentStatus('2026-10-04', 30, documentToday(at, 'Asia/Kuwait'))).toBe('EXPIRED');
  });
});

describe('documentView', () => {
  it('names the type and computes the badge from its current alert days', () => {
    const record: EmployeeDocumentRecord = {
      id: 'doc',
      business_id: businessId,
      employee_id: employeeId,
      type_code: 'passport',
      object_key: 'key',
      expires_on: '2026-10-20',
      uploaded_by: userId,
      recorded_at: '2026-10-04T08:00:00.000Z',
      replaced_at: null,
    };
    expect(documentView(record, type, '2026-10-04')).toEqual({
      id: 'doc',
      employee_id: employeeId,
      type_code: 'passport',
      type_name_en: 'Passport',
      type_name_ar: null,
      object_key: 'key',
      expires_on: '2026-10-20',
      uploaded_by: userId,
      recorded_at: '2026-10-04T08:00:00.000Z',
      status: 'EXPIRING',
    });
    expect(documentView(record, { ...type, alert_days: 10 }, '2026-10-04').status).toBe('VALID');
  });
});
