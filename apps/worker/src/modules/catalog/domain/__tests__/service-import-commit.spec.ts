import { expect, it } from 'vitest';

import {
  ServiceImportCommitError,
  importedServiceSnapshot,
  requireServiceImportRequestLive,
  serviceImportCategoryIds,
  type ImportedServiceRecord,
} from '../service-import-commit.ts';

// تثبيت الاستيراد: صلاحية الطلب تُقاس وقت القبول لا وقت التنفيذ، وقفل التصنيفات
// بأعرافها الصاعدة بلا تكرار، ولقطة التدقيق بنفس شكل الإنشاء اليدوي.

const AT = '2026-11-22T10:00:00.000Z';
const BUSINESS_ID = '01920000-0000-7000-8000-000000000002';

function commitRefusal(requestedAt: string): ServiceImportCommitError {
  try {
    requireServiceImportRequestLive({ requested_at: requestedAt, expires_at: AT });
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceImportCommitError);
    return error as ServiceImportCommitError;
  }
  throw new Error('the expired request was expected to be refused');
}

it('keeps a request accepted before the expiry', () => {
  expect(() =>
    requireServiceImportRequestLive({
      requested_at: '2026-11-22T09:00:00.000Z',
      expires_at: AT,
    }),
  ).not.toThrow();
});

it.each([
  ['at the expiry instant', AT],
  ['after the expiry instant', '2026-11-22T10:00:00.001Z'],
])('refuses a request %s with the named expiry refusal', (_name, requested_at) => {
  expect(commitRefusal(requested_at).code).toBe('IMPORT_PREVIEW_EXPIRED');
});

it('collects the category ids once, ascending, and skips the rows without one', () => {
  expect(
    serviceImportCategoryIds([
      { category_id: 'b' },
      { category_id: null },
      { category_id: 'a' },
      { category_id: 'b' },
      { category_id: 'c' },
    ]),
  ).toEqual(['a', 'b', 'c']);
});

it('collects no category id for an empty preview', () => {
  expect(serviceImportCategoryIds([])).toEqual([]);
});

const RECORD: ImportedServiceRecord = {
  id: '01920000-0000-7000-8000-000000000001',
  business_id: BUSINESS_ID,
  name_en: 'Imported service',
  name_ar: null,
  price: '12.500',
  commission_rule_kind: 'FOLLOW_PLAN',
  commission_pct_bps: null,
  commission_fixed_amount: null,
  counts_toward_threshold: true,
  duration_minutes: 30,
  category_id: null,
  created_at: AT,
};

const snapshot = (overrides: Partial<ImportedServiceRecord> = {}) =>
  importedServiceSnapshot({ ...RECORD, ...overrides });

it('writes the follow-plan rule into the audit snapshot', () => {
  expect(snapshot({ commission_rule_kind: 'FOLLOW_PLAN' }).commission_rule).toEqual({
    kind: 'FOLLOW_PLAN',
  });
});

it('writes the zero rule into the audit snapshot', () => {
  expect(snapshot({ commission_rule_kind: 'ZERO' }).commission_rule).toEqual({ kind: 'ZERO' });
});

it('writes the percentage rule with its basis points', () => {
  expect(
    snapshot({ commission_rule_kind: 'PCT', commission_pct_bps: 1500 }).commission_rule,
  ).toEqual({ kind: 'PCT', value: 1500 });
});

it('writes the fixed rule with its amount', () => {
  expect(
    snapshot({ commission_rule_kind: 'FIXED', commission_fixed_amount: '2.500' }).commission_rule,
  ).toEqual({ kind: 'FIXED', value: '2.500' });
});

it('writes the imported service as a fresh open revision', () => {
  const written = snapshot();
  expect(written.revision).toBe(1);
  expect(written.updated_at).toBe(written.created_at);
  expect(written.closed_at).toBeNull();
  expect(written.closed_by_category_id).toBeNull();
});

it('names the import commit refusal with its stable code', () => {
  const error = new ServiceImportCommitError('IMPORT_PREVIEW_EXPIRED');
  expect(error.name).toBe('ServiceImportCommitError');
  expect(error.code).toBe('IMPORT_PREVIEW_EXPIRED');
  expect(error.message).toBe('IMPORT_PREVIEW_EXPIRED');
});
