import { AssertionError } from 'node:assert';
import { expect, it } from 'vitest';
import { isStatisticsDependentFailure } from './own-service-lines.retry.ts';

it('treats only a statement cancel or a transaction deadline as a statistics-dependent failure', () => {
  const cancelled = Object.assign(new Error('canceling statement due to statement timeout'), {
    code: '57014',
  });
  const deadline = Object.assign(new Error('transaction deadline passed'), {
    name: 'TimeoutError',
  });
  expect(isStatisticsDependentFailure(cancelled)).toBe(true);
  expect(isStatisticsDependentFailure(deadline)).toBe(true);
  expect(isStatisticsDependentFailure(new Error('Failed query', { cause: cancelled }))).toBe(true);
});

it('lets a result mismatch or any other error propagate instead of retrying it away', () => {
  expect(isStatisticsDependentFailure(new AssertionError({ message: 'oracle mismatch' }))).toBe(
    false,
  );
  expect(isStatisticsDependentFailure(new Error('Own service line source is missing'))).toBe(false);
  expect(isStatisticsDependentFailure(Object.assign(new Error('x'), { code: '23505' }))).toBe(
    false,
  );
  expect(isStatisticsDependentFailure('57014')).toBe(false);
  expect(isStatisticsDependentFailure(undefined)).toBe(false);
});
