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
    for (const value of [iban, spaced, spaced.toLowerCase()]) {
      expect(sanitize(`Failed account ${value}.`)).toBe('Failed account [REDACTED].');
    }
  });

  it('keeps error codes, UUIDs and ordinary words that start like a country code', () => {
    for (const text of [
      'IBAN_CHECKSUM_INVALID 01920000-0000-7000-8000-0000000000a2',
      'qa team saw some account totals drift across the whole board ok',
      'om batch processed customers without any failures today',
    ]) {
      expect(sanitize(text)).toBe(text);
    }
  });
});
