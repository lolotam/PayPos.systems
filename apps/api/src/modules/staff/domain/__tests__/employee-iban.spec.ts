import { GCC_BANKS } from '@pospay/domain';
import { expect, it } from 'vitest';
import { ibanAuditSnapshot, nextIbanEntry, validateIbanEntry } from '../employee-iban.ts';
const input = {
  iban: 'KW81CBKU0000000000001234560101',
  bank_id: 'kw-cbk',
  holder_name_en: '  SYNTHETIC   HOLDER ',
  reason: ' Test ',
};
const terms = () => validateIbanEntry(input, GCC_BANKS);
const first = () => nextIbanEntry(null, terms(), 'entry', 'employee', 'actor', 0);
it('normalizes holder whitespace and reason, retaining only English name characters', () => {
  expect(terms()).toMatchObject({ holder_name_en: 'SYNTHETIC HOLDER', reason: 'Test' });
  for (const name of ['A', "Anne O'Neil-Smith.", 'A'.repeat(100)])
    expect(validateIbanEntry({ ...input, holder_name_en: name }, GCC_BANKS).holder_name_en).toBe(
      name,
    );
  for (const name of ['', ' ', 'عربي', '.Name', '1Name', 'A'.repeat(101), 'SARA_ALI'])
    expect(() => validateIbanEntry({ ...input, holder_name_en: name }, GCC_BANKS)).toThrow(
      'IBAN_HOLDER_NAME_INVALID',
    );
});
it('requires all three bank fields together and reason within bounds', () => {
  for (const change of [
    { iban: null },
    { bank_id: null },
    { holder_name_en: null },
    { reason: '' },
    { reason: ' ' },
    { reason: 'a'.repeat(501) },
  ])
    expect(() => validateIbanEntry({ ...input, ...change }, GCC_BANKS)).toThrow(
      'VALIDATION_FAILED',
    );
  expect(
    validateIbanEntry(
      { iban: null, bank_id: null, holder_name_en: null, reason: 'Clear' },
      GCC_BANKS,
    ).iban,
  ).toBeNull();
  expect(validateIbanEntry({ ...input, reason: 'a'.repeat(500) }, GCC_BANKS).reason).toHaveLength(
    500,
  );
});
it('requires a listed bank of the country and the mapped bank when the code is known', () => {
  for (const bank_id of ['kw-nbk', 'kw-other', 'unknown', 'bh-nbb'])
    expect(() => validateIbanEntry({ ...input, bank_id }, GCC_BANKS)).toThrow('IBAN_BANK_INVALID');
  const unknownCodes = GCC_BANKS.map((b) => ({ ...b, ibanBankCode: null }));
  for (const bank_id of ['kw-cbk', 'kw-nbk', 'kw-other'])
    expect(validateIbanEntry({ ...input, bank_id }, unknownCodes).bank_id).toBe(bank_id);
});
it('checks revision before no-op and increments only effective changes', () => {
  const current = first();
  expect(current?.revision).toBe(1);
  expect(nextIbanEntry(current, terms(), 'next', 'employee', 'actor', 1)).toBeNull();
  expect(() => nextIbanEntry(current, terms(), 'next', 'employee', 'actor', 0)).toThrow(
    'EMPLOYEE_IBAN_REVISION_CONFLICT',
  );
  const clear = { iban: null, bank_id: null, holder_name_en: null, reason: 'Clear' };
  const cleared = nextIbanEntry(current, clear, 'next', 'employee', 'actor', 1);
  expect(cleared).toMatchObject({ id: 'next', revision: 2, iban: null });
  expect(nextIbanEntry(cleared, clear, 'none', 'employee', 'actor', 2)).toBeNull();
  expect(nextIbanEntry(null, clear, 'none', 'employee', 'actor', 0)).toBeNull();
  expect(
    nextIbanEntry(
      current,
      { ...terms(), holder_name_en: 'CHANGED NAME' },
      'next',
      'employee',
      'actor',
      1,
    )?.revision,
  ).toBe(2);
});
it('audit projection contains no account or holder name', () => {
  expect(ibanAuditSnapshot(first())).toEqual({
    entry_id: 'entry',
    revision: 1,
    iban_last4: '0101',
    bank_id: 'kw-cbk',
    cleared: false,
  });
  expect(ibanAuditSnapshot(null)).toBeNull();
});
