import { describe, expect, it } from 'vitest';

import { customerForReception } from '../customer.ts';
import { InvalidCustomerPhoneError } from '../errors.ts';
import { maskPhone, normalizePhone } from '../phone.ts';

// النطاق المحجوز للأمثلة يمنع استخدام هاتف عميل حقيقي في الاختبارات.
const SYNTHETIC = '+12025550123';
const input = (national_number: string, calling_code = '1') => ({ calling_code, national_number });
const INVALID = [
  ...[
    '',
    '0',
    '000',
    '()- .',
    '+2025550123',
    '2025550123x1',
    '٢٠٢٥٥٥٠١٢٣',
    '２０２５５５０１２３',
    '2025550123\n',
    '2025550123\r',
    '2025550123\t',
    '2025550123\u0000',
    '202/555/0123',
    '2'.repeat(15),
  ].map((n) => input(n)),
  ...['', '0', '01', '0965', '+965', ' 965', '965 ', '965\n', '١', '1234'].map((c) =>
    input('2', c),
  ),
  input('2'.repeat(13), '123'),
  input('1234567', '965'),
  input('123456789', '965'),
  input('0001234567', '965'),
];

describe('customer E.164 normalization', () => {
  it.each([
    [input('2025550123'), SYNTHETIC],
    [input('0002025550123'), SYNTHETIC],
    [input(' (0202) 555-01.23 '), SYNTHETIC],
    [input('2'), '+12'],
    [input('2'.repeat(14)), `+1${'2'.repeat(14)}`],
    [input('2'.repeat(12), '123'), `+123${'2'.repeat(12)}`],
    [input('12345678', '965'), '+96512345678'],
    [input('00012 345-678', '965'), '+96512345678'],
  ] as const)('normalizes selected country and national number: %j', (phone, expected) => {
    expect(normalizePhone(phone)).toBe(expected);
  });

  it.each(INVALID)('refuses invalid input without retaining its value: %j', (phone) => {
    expect(() => normalizePhone(phone)).toThrow(InvalidCustomerPhoneError);
    try {
      normalizePhone(phone);
    } catch (error) {
      expect(error).toMatchObject({
        name: 'InvalidCustomerPhoneError',
        message: 'INVALID_CUSTOMER_PHONE',
      });
      expect(Object.keys(error as object)).toEqual(['name']);
    }
  });
});

describe('reception privacy', () => {
  it('masks all but the final three digits with a fixed prefix', () => {
    expect(maskPhone(SYNTHETIC)).toBe('***123');
    expect(maskPhone('+12')).toBe('***12');
    expect(maskPhone(`+1${'2'.repeat(14)}`)).toBe('***222');
  });

  it.each([null, new Date('2026-10-01T00:00:00Z')])(
    'projects only allowed fields and opt-out: %s',
    (optedOutAt) => {
      expect(
        customerForReception({
          id: 'customer-id',
          name: 'Example',
          phone: SYNTHETIC,
          locale: 'ar',
          optedOutAt,
        }),
      ).toEqual({
        id: 'customer-id',
        name: 'Example',
        phone: '***123',
        locale: 'ar',
        opted_out: optedOutAt !== null,
      });
    },
  );
});
