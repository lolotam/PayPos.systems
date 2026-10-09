import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger.ts';
import { redactSecrets, sanitize } from '../redaction.ts';

// The registry's published Kuwait example — never a real account (spec 040 BR-001).
const IBAN = 'KW81CBKU0000000000001234560101';
const HOLDER = 'SYNTHETIC HOLDER';

const capture = (value: object): string => {
  let written = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  createLogger('info', { destination: sink, events: ['event'] }).info(value, 'event');
  return written;
};

describe('employee IBAN redaction (spec 040 TD-5)', () => {
  it.each(['iban', 'employee_iban', 'accountHolderName', 'holder_name_en', 'holder_name_ar'])(
    'redacts reasons beside %s in logger objects and nested arrays',
    (key) => {
      const reason = `Changed account for ${HOLDER}`;
      const record = { [key]: key.endsWith('iban') ? IBAN : HOLDER, reason };
      for (const value of [record, { records: [{ nested: record }] }]) {
        const line = capture(value);
        expect(line).not.toContain(IBAN);
        expect(line).not.toContain(HOLDER);
        expect(line).not.toContain(reason);
        expect(line).toContain('"reason":"[REDACTED]"');
      }
      expect(sanitize({ reason: 'Service unavailable' })).toEqual({
        reason: 'Service unavailable',
      });
      expect(redactSecrets(record)).toMatchObject({ reason });
    },
  );

  it('redacts IBAN and holder containers at depth and in arrays while keeping last4', () => {
    const value = {
      records: [
        {
          nested: {
            iban: IBAN,
            employee_iban: IBAN,
            holder_name_en: HOLDER,
            accountHolderName: HOLDER,
            iban_last4: '0101',
          },
        },
      ],
    };
    for (const clean of [sanitize(value), redactSecrets(value)]) {
      const text = JSON.stringify(clean);
      expect(text).not.toContain(IBAN);
      expect(text).not.toContain(HOLDER);
      expect(text).toContain('0101');
    }
    const line = capture(value);
    expect(line).not.toContain(IBAN);
    expect(line).not.toContain(HOLDER);
  });
});

describe('employee IBAN free-text redaction (spec 040 TD-5)', () => {
  it.each([
    ['KW', 30],
    ['SA', 24],
    ['AE', 23],
    ['BH', 22],
    ['QA', 29],
    ['OM', 23],
  ] as const)('redacts %s IBAN-shaped tokens in free text, spaced or not', (country, length) => {
    const iban = country + '0'.repeat(length - 2);
    const spaced = iban.match(/.{1,4}/g)?.join(' ') ?? '';
    const separated = country + '  ' + iban.slice(2).split('').join('   ');
    const localized = [0x660, 0x6f0].map((start) =>
      separated.replace(/\d/g, (digit) => String.fromCharCode(start + Number(digit))),
    );
    for (const value of [
      iban,
      spaced,
      spaced.toLowerCase(),
      separated,
      separated.toLowerCase(),
      iban.split('').join(' '),
      ...localized,
    ]) {
      for (const clean of [sanitize, redactSecrets])
        expect(clean(`Failed account ${value}.`)).toBe('Failed account [REDACTED].');
    }
  });

  it.each([
    'K W81CBKU0000000000001234560101',
    'k   w  ٨  ١cbku0000000000001234560101',
    'KW 81CBKU0000000000001234560101',
    'KW81  CBKU  0000  0000  0000  1234  5601  01',
    'kw  8  1cbku0000000000001234560101',
  ])('redacts accepted spacing in free text: %s', (value) => {
    expect(sanitize(`Failed account ${value}.`)).toBe('Failed account [REDACTED].');
    expect(redactSecrets(`Failed account ${value}.`)).toBe('Failed account [REDACTED].');
    expect(capture({ message: value })).not.toContain(value);
  });

  it('keeps error codes, UUIDs and ordinary words that start like a country code', () => {
    for (const text of [
      'IBAN_CHECKSUM_INVALID 01920000-0000-7000-8000-0000000000a2',
      'qa team saw some account totals drift across the whole board ok',
      'om batch processed customers without any failures today',
      'QA 1 team saw some account totals drift across the whole board ok',
      'Q A 1 team saw some account totals drift across the whole board ok',
    ]) {
      expect(sanitize(text)).toBe(text);
    }
  });
});
