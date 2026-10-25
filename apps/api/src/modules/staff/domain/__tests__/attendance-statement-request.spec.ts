import { describe, expect, it } from 'vitest';

import {
  statementFilename,
  statementPeriodIsValid,
  statementShiftPair,
} from '../attendance-statement-request.ts';

const valid = (from: string, to: string, now: string, timezone = 'Asia/Kuwait') =>
  statementPeriodIsValid(from, to, new Date(now), timezone);

describe('statementPeriodIsValid', () => {
  it('refuses November while it is still October in the branch timezone', () => {
    expect(valid('2026-11-01', '2026-11-30', '2026-10-31T20:59:00.000Z')).toBe(false);
  });

  it('accepts November as soon as it starts in the branch timezone', () => {
    expect(valid('2026-11-01', '2026-11-30', '2026-10-31T21:00:00.000Z')).toBe(true);
  });

  it('refuses December after November starts in the branch timezone', () => {
    expect(valid('2026-11-01', '2026-12-01', '2026-10-31T21:00:00.000Z')).toBe(false);
  });

  it('refuses a period whose start is after its end', () => {
    expect(valid('2026-10-23', '2026-10-22', '2026-10-23T07:00:00.000Z')).toBe(false);
  });

  it('accepts exactly 366 inclusive days', () => {
    expect(valid('2024-01-01', '2024-12-31', '2026-01-15T12:00:00.000Z', 'UTC')).toBe(true);
  });

  it('refuses 367 inclusive days', () => {
    expect(valid('2024-01-01', '2025-01-01', '2026-01-15T12:00:00.000Z', 'UTC')).toBe(false);
  });

  it('accepts one day', () => {
    expect(valid('2026-10-23', '2026-10-23', '2026-10-23T07:00:00.000Z')).toBe(true);
  });

  it('refuses malformed calendar dates', () => {
    expect(valid('2026-02-30', '2026-10-23', '2026-10-23T07:00:00.000Z')).toBe(false);
    expect(valid('30/09/2026', '2026-10-23', '2026-10-23T07:00:00.000Z')).toBe(false);
  });
});

describe('statementFilename', () => {
  it('builds the branch filename without personal names', () => {
    expect(statementFilename('BRANCH', '2026-10-01', '2026-10-31')).toBe(
      'attendance-statement-branch-2026-10-01_2026-10-31.pdf',
    );
  });

  it('builds the employee filename without personal names', () => {
    expect(statementFilename('EMPLOYEE', '2026-10-01', '2026-10-31')).toBe(
      'attendance-statement-employee-2026-10-01_2026-10-31.pdf',
    );
  });
});

describe('statementShiftPair', () => {
  it('keeps a supplied pair and represents a missing filter with null', () => {
    expect(statementShiftPair({ start: '09:00', end: '20:00' })).toEqual({
      start: '09:00',
      end: '20:00',
    });
    expect(statementShiftPair()).toBeNull();
  });
});
