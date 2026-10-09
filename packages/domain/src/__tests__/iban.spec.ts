import { expect, it } from 'vitest';
import {
  formatIbanForDisplay,
  ibanBankCode,
  ibanChecksumValid,
  maskIban,
  normalizeIban,
  validateIban,
} from '../iban.js';

const example = 'KW81CBKU0000000000001234560101';
function generated(country: string, bban: string) {
  const digits = `${bban}${country}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return `${country}${String(98 - remainder).padStart(2, '0')}${bban}`;
}
const cases = [
  ['KW', 'CBKU' + '0'.repeat(21) + '1', 'CBKU'],
  ['SA', '10' + '0'.repeat(17) + '1', '10'],
  ['AE', '001' + '0'.repeat(15) + '1', '001'],
  ['BH', 'NBOB' + '0'.repeat(13) + '1', 'NBOB'],
  ['QA', 'QNBA' + '0'.repeat(20) + '1', 'QNBA'],
  ['OM', '001' + '0'.repeat(15) + '1', '001'],
] as const;
it('normalizes ASCII spaces, lower case and both Arabic digit sets; refuses tabs and punctuation', () => {
  for (const start of [0x660, 0x6f0]) {
    const localized = example
      .toLowerCase()
      .replace(/\d/g, (n) => String.fromCharCode(start + Number(n)));
    expect(normalizeIban(` ${localized.slice(0, 4)} ${localized.slice(4)} `)).toBe(example);
  }
  expect(validateIban(example)).toMatchObject({ ok: true, iban: example });
  for (const value of [
    example + '\t',
    example + '\n',
    example + '-',
    example + 'é',
    'K' + example.slice(1),
  ])
    expect(validateIban(value)).toEqual({ ok: false, reason: 'FORMAT' });
});
it.each(cases)('checks %s length, BBAN shape and extracts its bank code', (country, bban, code) => {
  const value = generated(country, bban);
  expect(validateIban(value)).toEqual({ ok: true, iban: value, country, bankCode: code });
  expect(ibanBankCode(value)).toBe(code);
  for (const bad of [
    value.slice(0, -1),
    value + '0',
    generated(country, (/[A-Z]/.test(bban.charAt(0)) ? '1' : 'A') + bban.slice(1)),
  ])
    expect(validateIban(bad)).toEqual({ ok: false, reason: 'FORMAT' });
});
it.each(['GB', 'EG', 'DE'])('refuses %s explicitly', (country) => {
  expect(validateIban(generated(country, '0'.repeat(18)))).toEqual({
    ok: false,
    reason: 'COUNTRY',
  });
});
// TODO(spec): SC-002/T002 conflicts with MOD 97: replacing position 10 with K preserves the checksum. Owner clarification is pending.
it('detects every single substitution and unequal adjacent transposition of the registry example', () => {
  expect(ibanChecksumValid(example)).toBe(true);
  for (let at = 0; at < example.length; at++) {
    for (const char of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (char === example[at]) continue;
      expect(validateIban(example.slice(0, at) + char + example.slice(at + 1)).ok).toBe(false);
    }
    if (at < example.length - 1 && example[at] !== example[at + 1]) {
      expect(
        validateIban(example.slice(0, at) + example[at + 1] + example[at] + example.slice(at + 2))
          .ok,
      ).toBe(false);
    }
  }
  expect(validateIban(example.slice(0, -1) + '2')).toEqual({ ok: false, reason: 'CHECKSUM' });
  expect(ibanChecksumValid('?!')).toBe(false);
});
it('masks and formats without exposing extra characters', () => {
  expect(maskIban(example)).toBe('0101');
  expect(formatIbanForDisplay(example)).toBe('KW81 CBKU 0000 0000 0000 1234 5601 01');
});
