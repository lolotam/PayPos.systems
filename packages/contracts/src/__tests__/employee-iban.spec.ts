import { expect, it } from 'vitest';
import {
  employeeIbanHistoryQuery,
  employeeIbanView,
  setEmployeeIbanInput,
} from '../staff/employee-iban.js';
const input = {
  iban: 'KW81CBKU0000000000001234560101',
  bank_id: 'kw-cbk',
  holder_name_en: 'SYNTHETIC HOLDER',
  reason: ' Test ',
  expected_revision: 0,
};
it('accepts strict set and clear commands with mandatory trimmed reason and revision', () => {
  expect(setEmployeeIbanInput.parse(input).reason).toBe('Test');
  expect(
    setEmployeeIbanInput.safeParse({ ...input, iban: null, bank_id: null, holder_name_en: null })
      .success,
  ).toBe(true);
  for (const change of [
    { iban: null },
    { bank_id: null },
    { holder_name_en: null },
    { reason: ' ' },
    { reason: 'x'.repeat(501) },
    { expected_revision: -1 },
    { expected_revision: 1.1 },
    { expected_revision: undefined },
    { extra: input.iban },
    { iban: 'x'.repeat(65) },
    { bank_id: 'x'.repeat(49) },
    { holder_name_en: 'x'.repeat(201) },
  ]) {
    expect(setEmployeeIbanInput.safeParse({ ...input, ...change }).success).toBe(false);
  }
});
it('bounds descending revision cursors and page sizes', () => {
  expect(employeeIbanHistoryQuery.parse({})).toEqual({ limit: 20 });
  expect(employeeIbanHistoryQuery.parse({ cursor: '2', limit: '100' })).toEqual({
    cursor: 2,
    limit: 100,
  });
  for (const query of [{ cursor: 0 }, { cursor: 1.2 }, { limit: 0 }, { limit: 101 }])
    expect(employeeIbanHistoryQuery.safeParse(query).success).toBe(false);
});
it('requires the complete masked view shape and refuses extra fields', () => {
  const view = {
    status: 'SET',
    iban_last4: '0101',
    iban: null,
    bank_id: null,
    holder_name_en: null,
    revision: 1,
    set_at: '2026-10-09T00:00:00.000Z',
    set_by: null,
    can_read_full: false,
    can_manage: false,
  };
  expect(employeeIbanView.parse(view)).toEqual(view);
  expect(employeeIbanView.safeParse({ ...view, iban_last4: '12345' }).success).toBe(false);
  expect(employeeIbanView.safeParse({ ...view, reason: input.iban }).success).toBe(false);
});
