import { expect, it } from 'vitest';

import {
  CUSTOMER_IMPORT_INVALID_CELL,
  CustomerImportError,
  customerImportCallingCode,
  decideCustomerImportCommit,
  validateCustomerImportFile,
  type CustomerImportCellValues,
  type CustomerImportCommitPreview,
  type CustomerImportFileFacts,
} from '../customer-import.ts';
import {
  finalizeCustomerImportRows,
  validateCustomerImportSheet,
} from '../customer-import-rows.ts';

const VALUES: CustomerImportCellValues = {
  yes: 'نعم',
  no: 'لا',
  male: 'ذكر',
  female: 'أنثى',
};

const COMPANY = '01990000-0000-7000-8000-000000000001';
const BUSINESS = '01990000-0000-7000-8000-000000000002';
const USER = '01990000-0000-7000-8000-000000000003';

const facts = (overrides: Partial<CustomerImportFileFacts> = {}): CustomerImportFileFacts => ({
  business_id: BUSINESS,
  created_by: USER,
  owner_module: 'customers',
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 1024,
  status: 'READY',
  storage_key: 'key/one',
  purged: false,
  purge_started: false,
  ...overrides,
});

const cells = (values: readonly (string | number | boolean | null)[]) => [
  { row: 2, cells: values },
];

const preview = (
  overrides: Partial<CustomerImportCommitPreview> = {},
): CustomerImportCommitPreview => ({
  id: '01990000-0000-7000-8000-000000000004',
  business_id: BUSINESS,
  created_by: USER,
  status: 'ready',
  expires_at: '2026-12-01T00:00:00.000Z',
  error_count: 0,
  ...overrides,
});

it('accepts a verified upload owned by the target business and its creator', () => {
  expect(validateCustomerImportFile(facts(), BUSINESS, USER)).toBe('key/one');
});
it.each([
  ['a missing file', null],
  ['a purged file', facts({ purged: true })],
  ['a file under purge', facts({ purge_started: true })],
  ['a file of another module', facts({ owner_module: 'staff' })],
  ['a file of another business', facts({ business_id: COMPANY })],
  ['a file of another user', facts({ created_by: COMPANY })],
])('refuses %s as not found', (_case, given) => {
  expect(() => validateCustomerImportFile(given, BUSINESS, USER)).toThrow(
    new CustomerImportError('IMPORT_FILE_NOT_FOUND'),
  );
});
it.each([
  ['a file still verifying', facts({ status: 'VERIFYING' }), 'IMPORT_FILE_NOT_READY'],
  ['a file of another type', facts({ content_type: 'text/csv' }), 'IMPORT_FILE_TYPE_INVALID'],
  ['an empty file', facts({ size_bytes: 0 }), 'IMPORT_FILE_SIZE_INVALID'],
  ['a file over the limit', facts({ size_bytes: 3 * 1024 * 1024 }), 'IMPORT_FILE_SIZE_INVALID'],
  ['a file without a key', facts({ storage_key: null }), 'IMPORT_FILE_NOT_FOUND'],
])('refuses %s with its own code', (_case, given, code) => {
  expect(() => validateCustomerImportFile(given, BUSINESS, USER)).toThrow(
    new CustomerImportError(code as 'IMPORT_FILE_NOT_READY'),
  );
});

it.each([
  ['KW', '965'],
  ['SA', '966'],
  ['AE', '971'],
  ['BH', '973'],
  ['QA', '974'],
  ['OM', '968'],
])('maps %s to %s', (country, callingCode) => {
  expect(customerImportCallingCode(country)).toBe(callingCode);
});
it.each([[null], ['ZZ'], [''], ['constructor']])(
  'refuses %s until the business country is set',
  (country) => {
    expect(() => customerImportCallingCode(country)).toThrow(
      new CustomerImportError('IMPORT_BUSINESS_COUNTRY_REQUIRED'),
    );
  },
);

it('reads a clean row and masks the phone', () => {
  const result = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', '', '', 'ذكر', '', '']),
    '965',
    VALUES,
  );
  expect(result.errors).toEqual([]);
  expect(result.candidates[0]).toMatchObject({
    name: 'أحمد',
    phone: '+96598765432',
    masked_phone: '***432',
    gender: 'male',
    locale: 'ar',
  });
});
it('keeps the full phone for the write and publishes only its masked form', () => {
  const result = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', '2000-02-29', 'لا', 'ذكر', 'a@b.co', 'ملاحظة']),
    '965',
    VALUES,
  );
  expect(result.candidates[0]).toMatchObject({
    phone: '+96598765432',
    masked_phone: '***432',
  });
});
it('lets an explicit country code override the business default', () => {
  const result = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '966', '', '', '', '', 'ذكر', '', '']),
    '965',
    VALUES,
  );
  expect(result.candidates[0]?.phone).toBe('+96698765432');
});
it.each([
  ['a missing name', ['', '98765432', '', '', '', '', '', 'ذكر', '', ''], 'IMPORT_REQUIRED_CELL'],
  [
    'a name with a control character',
    ['\n', '98765432', '', '', '', '', '', 'ذكر', '', ''],
    'IMPORT_NAME_INVALID',
  ],
  [
    'a name of spaces',
    ['   ', '98765432', '', '', '', '', '', 'ذكر', '', ''],
    'IMPORT_REQUIRED_CELL',
  ],
  ['an invalid phone', ['أحمد', 'abc', '', '', '', '', '', 'ذكر', '', ''], 'IMPORT_PHONE_INVALID'],
  [
    'an invalid country code',
    ['أحمد', '98765432', '0', '', '', '', '', 'ذكر', '', ''],
    'IMPORT_COUNTRY_CODE_INVALID',
  ],
  [
    'an invalid locale',
    ['أحمد', '98765432', '', 'fr', '', '', '', 'ذكر', '', ''],
    'IMPORT_LOCALE_INVALID',
  ],
  [
    'an invalid boolean',
    ['أحمد', '98765432', '', '', 'maybe', '', '', 'ذكر', '', ''],
    'IMPORT_BOOLEAN_INVALID',
  ],
  [
    'an invalid gender',
    ['أحمد', '98765432', '', '', '', '', '', 'x', '', ''],
    'IMPORT_GENDER_INVALID',
  ],
  [
    'an invalid email',
    ['أحمد', '98765432', '', '', '', '', '', 'ذكر', 'a@b', ''],
    'IMPORT_EMAIL_INVALID',
  ],
  [
    'an invalid note',
    ['أحمد', '98765432', '', '', '', '', '', 'ذكر', '', 'x'.repeat(501)],
    'IMPORT_NOTE_INVALID',
  ],
  [
    'a missing year flag',
    ['أحمد', '98765432', '', '', '', '2000-02-29', '', 'ذكر', '', ''],
    'IMPORT_YEAR_KNOWN_REQUIRED',
  ],
  [
    'an impossible date',
    ['أحمد', '98765432', '', '', '', '2001-02-29', 'نعم', 'ذكر', '', ''],
    'IMPORT_DATE_INVALID',
  ],
])('reports %s with its own code', (_case, values, code) => {
  const result = validateCustomerImportSheet(cells(values), '965', VALUES);
  expect(result.errors.map((issue) => issue.code)).toContain(code);
});
it('keeps the day and month only when the birth year is unknown', () => {
  const unknown = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', '2000-02-29', 'لا', 'ذكر', '', '']),
    '965',
    VALUES,
  );
  expect(unknown.errors).toEqual([]);
  expect(unknown.candidates[0]?.birthday).toEqual({ day: 29, month: 2, year: null });
  const known = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', '2000-02-29', 'نعم', 'ذكر', '', '']),
    '965',
    VALUES,
  );
  expect(known.errors).toEqual([]);
  expect(known.candidates[0]?.birthday).toEqual({ day: 29, month: 2, year: 2000 });
});
it('converts an Excel numeric date serial into a normalized birthday and rejects out-of-range serials', () => {
  const valid = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', 36585, 'نعم', 'ذكر', '', '']),
    '965',
    VALUES,
  );
  expect(valid.errors).toEqual([]);
  expect(valid.candidates[0]?.birthday).toEqual({ day: 29, month: 2, year: 2000 });
  const invalid = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', 0, 'نعم', 'ذكر', '', '']),
    '965',
    VALUES,
  );
  expect(invalid.errors).toEqual([{ row: 2, column: 'birthday', code: 'IMPORT_DATE_INVALID' }]);
});
it('reports an unreadable cell with its own code and skips the column', () => {
  const result = validateCustomerImportSheet(
    cells([CUSTOMER_IMPORT_INVALID_CELL, '98765432', '', '', '', '', '', 'ذكر', '', '']),
    '965',
    VALUES,
  );
  expect(result.errors).toEqual([{ row: 2, column: 'name', code: 'IMPORT_CELL_INVALID' }]);
});
it('reports data beyond the last header as an unexpected column', () => {
  const result = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', '', '', 'ذكر', '', '', 'extra']),
    '965',
    VALUES,
  );
  expect(result.errors).toEqual([
    { row: 2, column: 'unexpected_column', code: 'IMPORT_COLUMN_UNEXPECTED' },
  ]);
});
it('reports an unreadable cell beyond the last header as invalid, not unexpected', () => {
  const result = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', '', '', 'ذكر', '', '', CUSTOMER_IMPORT_INVALID_CELL]),
    '965',
    VALUES,
  );
  expect(result.errors).toEqual([
    { row: 2, column: 'unexpected_column', code: 'IMPORT_CELL_INVALID' },
  ]);
});
it('marks every row of the file when two rows carry the same phone', () => {
  const result = validateCustomerImportSheet(
    [
      { row: 2, cells: ['أحمد', '98765432', '', '', '', '', '', 'ذكر', '', ''] },
      { row: 3, cells: ['سالم', '98765432', '', '', '', '', '', 'ذكر', '', ''] },
    ],
    '965',
    VALUES,
  );
  expect(result.errors.map((issue) => issue.row).sort()).toEqual([2, 3]);
  expect(result.errors.every((issue) => issue.code === 'IMPORT_DUPLICATE_IN_FILE')).toBe(true);
});

const candidates = () =>
  validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', 'نعم', '', '', 'ذكر', '', '']),
    '965',
    VALUES,
  ).candidates;
it('requires a gender from a new customer', () => {
  const result = finalizeCustomerImportRows(
    validateCustomerImportSheet(
      cells(['أحمد', '98765432', '', '', '', '', '', '', '', '']),
      '965',
      VALUES,
    ).candidates,
    new Set(),
  );
  expect(result.rows).toEqual([]);
  expect(result.errors).toEqual([{ row: 2, column: 'gender', code: 'IMPORT_REQUIRED_CELL' }]);
});
it('accepts a new customer with a gender', () => {
  const result = finalizeCustomerImportRows(candidates(), new Set());
  expect(result.errors).toEqual([]);
  expect(result.rows[0]).toMatchObject({ status: 'new', warning: null, no_rating: true });
});
it('keeps candidate errors pure across repeated finalization with different existing phones', () => {
  const repeated = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', '', '', '', '', '', '']),
    '965',
    VALUES,
  ).candidates;
  const asNew = finalizeCustomerImportRows(repeated, new Set());
  expect(asNew.rows).toEqual([]);
  expect(asNew.errors).toEqual([{ row: 2, column: 'gender', code: 'IMPORT_REQUIRED_CELL' }]);
  const asExisting = finalizeCustomerImportRows(repeated, new Set(['+96598765432']));
  expect(asExisting.errors).toEqual([]);
  expect(asExisting.rows[0]).toMatchObject({ status: 'existing', phone: '+96598765432' });
});
it('accepts an existing customer without a gender and warns about the rating opt-out', () => {
  const existing = validateCustomerImportSheet(
    cells(['أحمد', '98765432', '', '', 'نعم', '', '', '', '', '']),
    '965',
    VALUES,
  ).candidates;
  const result = finalizeCustomerImportRows(existing, new Set(['+96598765432']));
  expect(result.errors).toEqual([]);
  expect(result.rows[0]).toMatchObject({
    status: 'existing',
    warning: 'EXISTING_NO_RATING_IGNORED',
  });
});

const now = new Date('2026-11-26T00:00:00.000Z');
it('requests a commit for a clean preview of its own creator', () => {
  expect(decideCustomerImportCommit(preview(), USER, BUSINESS, now)).toBe('request');
});
it('accepts a repeated request without a new event', () => {
  expect(
    decideCustomerImportCommit(preview({ status: 'commit_requested' }), USER, BUSINESS, now),
  ).toBe('already_accepted');
});
it.each([
  ['another creator', preview({ created_by: COMPANY })],
  ['another business', preview({ business_id: COMPANY })],
])('refuses a preview of %s as not found', (_case, given) => {
  expect(() => decideCustomerImportCommit(given, USER, BUSINESS, now)).toThrow(
    new CustomerImportError('IMPORT_PREVIEW_NOT_FOUND'),
  );
});
it('refuses an expired preview', () => {
  expect(() =>
    decideCustomerImportCommit(
      preview({ expires_at: '2026-01-01T00:00:00.000Z' }),
      USER,
      BUSINESS,
      now,
    ),
  ).toThrow(new CustomerImportError('IMPORT_PREVIEW_EXPIRED'));
});
it('refuses a failed preview', () => {
  expect(() =>
    decideCustomerImportCommit(preview({ status: 'failed' }), USER, BUSINESS, now),
  ).toThrow(new CustomerImportError('IMPORT_PREVIEW_EXPIRED'));
});
it('refuses a preview that still carries row errors', () => {
  expect(() =>
    decideCustomerImportCommit(preview({ error_count: 2 }), USER, BUSINESS, now),
  ).toThrow(new CustomerImportError('IMPORT_PREVIEW_HAS_ERRORS'));
});
