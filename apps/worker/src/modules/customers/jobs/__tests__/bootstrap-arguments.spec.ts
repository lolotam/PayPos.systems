import { describe, expect, it } from 'vitest';
import { instantOf, readArguments } from '../bootstrap-arguments.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const CHECKPOINT = '01920000-0000-7000-8000-0000000000a1';
const MAX_SESSION = '01920000-0000-7000-8000-0000000000a2';

describe('instantOf', () => {
  it('accepts a valid instant', () => {
    expect(instantOf('2026-06-01T12:00:00.000Z')?.toISOString()).toBe('2026-06-01T12:00:00.000Z');
    expect(instantOf('2026-06-01T15:00:00+03:00')?.toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  it('rejects a date the calendar does not have', () => {
    expect(() => instantOf('2026-02-30T00:00:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a month outside the calendar', () => {
    expect(() => instantOf('2026-13-01T00:00:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a day the month does not have', () => {
    expect(() => instantOf('2026-04-31T00:00:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects an hour above 23', () => {
    expect(() => instantOf('2026-01-01T24:00:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a minute or a second above 59', () => {
    expect(() => instantOf('2026-01-01T12:60:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
    expect(() => instantOf('2026-01-01T12:00:60Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a text that is not an instant', () => {
    expect(() => instantOf('2026-06-01')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });
});

describe('instantOf on leap days', () => {
  it('accepts a leap day of a leap year', () => {
    expect(instantOf('2024-02-29T00:00:00Z')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(instantOf('2000-02-29T12:00:00Z')?.toISOString()).toBe('2000-02-29T12:00:00.000Z');
  });

  it('rejects a leap day of a year that is not a leap year', () => {
    expect(() => instantOf('2026-02-29T00:00:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
    expect(() => instantOf('2100-02-29T00:00:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('accepts the last second of a day and refuses the hour above it', () => {
    expect(instantOf('2026-01-01T23:59:59Z')?.toISOString()).toBe('2026-01-01T23:59:59.000Z');
    expect(() => instantOf('2026-01-01T24:00:00Z')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });
});

describe('readArguments', () => {
  it('parses the full argument list', () => {
    const params = readArguments([
      '--company',
      COMPANY,
      '--cutoff',
      '2026-06-01T12:00:00Z',
      '--checkpoint',
      CHECKPOINT,
      '--max-session-id',
      MAX_SESSION,
      '--recorded-before',
      '2026-06-01T13:00:00Z',
      '--page-size',
      '50',
    ]);
    expect(params.companyId).toBe(COMPANY);
    expect(params.cutoff.toISOString()).toBe('2026-06-01T12:00:00.000Z');
    expect(params.checkpoint).toBe(CHECKPOINT);
    expect(params.maxSessionId).toBe(MAX_SESSION);
    expect(params.recordedAtOrBefore?.toISOString()).toBe('2026-06-01T13:00:00.000Z');
    expect(params.pageSize).toBe(50);
  });

  it('parses the two required arguments alone', () => {
    const params = readArguments(['--company', COMPANY, '--cutoff', '2026-06-01T12:00:00Z']);
    expect(params.companyId).toBe(COMPANY);
    expect(params.checkpoint).toBeUndefined();
    expect(params.pageSize).toBeUndefined();
  });
});

describe('readArguments refusals', () => {
  it('rejects an unknown flag', () => {
    expect(() =>
      readArguments(['--company', COMPANY, '--cutoff', '2026-06-01T12:00:00Z', '--bogus', '1']),
    ).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a repeated flag', () => {
    expect(() =>
      readArguments([
        '--company',
        COMPANY,
        '--company',
        COMPANY,
        '--cutoff',
        '2026-06-01T12:00:00Z',
      ]),
    ).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a flag without a value', () => {
    expect(() => readArguments(['--company'])).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a missing required argument', () => {
    expect(() => readArguments(['--company', COMPANY])).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a company that is not a uuid', () => {
    expect(() =>
      readArguments(['--company', 'not-a-uuid', '--cutoff', '2026-06-01T12:00:00Z']),
    ).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
  });

  it('rejects a page size of zero or above two hundred', () => {
    const withSize = (size: string) =>
      readArguments([
        '--company',
        COMPANY,
        '--cutoff',
        '2026-06-01T12:00:00Z',
        '--page-size',
        size,
      ]);
    expect(() => withSize('0')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
    expect(() => withSize('201')).toThrow('BOOTSTRAP_ARGUMENT_INVALID');
    expect(withSize('200').pageSize).toBe(200);
  });
});
