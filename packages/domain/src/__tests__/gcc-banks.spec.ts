import { expect, it } from 'vitest';
import { GCC_IBAN_COUNTRIES } from '../iban.js';
import { GCC_BANKS, bankForIbanCode, banksForCountry, findGccBank } from '../gcc-banks.js';
it('has unique stable ids, complete countries, unique known codes and one Other per country', () => {
  expect(new Set(GCC_BANKS.map((b) => b.id)).size).toBe(GCC_BANKS.length);
  expect(GCC_BANKS).toHaveLength(46);
  for (const country of GCC_IBAN_COUNTRIES) {
    const banks = banksForCountry(country);
    expect(banks.length).toBeGreaterThan(1);
    expect(banks.filter((b) => b.id === `${country.toLowerCase()}-other`)).toHaveLength(1);
    const codes = banks.flatMap((b) => (b.ibanBankCode === null ? [] : [b.ibanBankCode]));
    expect(new Set(codes).size).toBe(codes.length);
    for (const bank of banks) {
      expect(bank.id.startsWith(`${country.toLowerCase()}-`)).toBe(true);
      expect(bank.nameAr).toMatch(/[\u0600-\u06ff]/);
      expect(bank.nameEn.length).toBeGreaterThan(0);
      if (['SA', 'AE', 'OM'].includes(country)) expect(bank.ibanBankCode).toBeNull();
      else if (bank.ibanBankCode !== null) expect(bank.ibanBankCode).toMatch(/^[A-Z]{4}$/);
      expect(findGccBank(bank.id)).toBe(bank);
      if (bank.ibanBankCode) expect(bankForIbanCode(country, bank.ibanBankCode)).toBe(bank);
    }
  }
  expect(findGccBank('unknown')).toBeUndefined();
  expect(bankForIbanCode('KW', 'ZZZZ')).toBeUndefined();
});
