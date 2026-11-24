import { expect, it } from 'vitest';

import { markCommissionStatementPaidInput } from '../statement-payments.js';

it.each([
  ['ordinary note', 'Bank reference', true],
  ['Arabic note', 'تم الصرف', true],
  ['NUL within a note', 'before\u0000after', false],
  ['NUL alone', '\u0000', false],
])('validates a payment note: %s', (_label, paid_note, valid) => {
  expect(
    markCommissionStatementPaidInput.safeParse({
      paid_method: 'BANK_TRANSFER',
      paid_on: '2026-11-24',
      paid_note,
    }).success,
  ).toBe(valid);
});
