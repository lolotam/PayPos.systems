import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger.ts';
import { REDACTED, sanitize } from '../redaction.ts';

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

// قيمة اصطناعية واحدة: مفيش اسم عميل ولا تاريخ ميلاد حقيقي في اختبار.
const PROFILE_VALUE = 'synthetic-profile-value';

describe('the customer profile keys never reach a technical log (D-10)', () => {
  it.each([
    'birthday',
    'birthdays',
    'birth_month',
    'birthMonth',
    'birth_year',
    'birthDate',
    'gender',
    'genders',
    'note',
    'notes',
    'customer_note',
    'customerNotes',
  ])('redacts %s at any depth and inside arrays', (key) => {
    const record = { [key]: PROFILE_VALUE };
    for (const value of [record, { records: [{ nested: record }] }]) {
      const line = capture(value);
      expect(line).not.toContain(PROFILE_VALUE);
      expect(line).toContain(REDACTED);
    }
  });

  it('leaves an unrelated key that only looks similar untouched', () => {
    const line = capture({ footnote: 'a footnote', noteCount: 3, notesTotal: 7 });
    expect(line).toContain('a footnote');
    expect(line).toContain('3');
    expect(line).toContain('7');
  });

  it('keeps the email and phone rules as they were', () => {
    const line = capture({
      email: 'synthetic.owner@example.invalid',
      phone: '+96550012345',
      notes: [{ note: PROFILE_VALUE }],
    });
    expect(line).not.toContain('synthetic.owner@example.invalid');
    expect(line).not.toContain('50012345');
    expect(line).toContain('***345');
  });

  it('the sanitiser redacts the profile; the audit snapshot keeps its own rules', () => {
    expect(sanitize({ gender: PROFILE_VALUE, note: PROFILE_VALUE })).toEqual({
      gender: REDACTED,
      note: REDACTED,
    });
  });
});
