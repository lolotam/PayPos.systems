import {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  StatementPeriodClosedError,
} from '@pospay/db';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../shared/errors.ts';
import { CommissionPlanVersionError } from '../domain/errors.ts';
import { mapCommissionWriteError } from '../http/commission-input-errors.ts';
import { CommissionStatementPayError } from '../use-cases/mark-statement-paid/mark-statement-paid.usecase.ts';

/** الخطأ اللي بتطلعه الميزانية القصيرة للمعاملة: خطأ عادي اسمه TimeoutError. */
function timeoutError(): Error {
  return Object.assign(new Error('transaction deadline passed'), { name: 'TimeoutError' });
}

/** يلتقط الخطأ اللي رميته الدالة بدل ما يعمل سطر expectation واحد على كل حالة. */
function caughtBy(error: unknown): unknown {
  try {
    mapCommissionWriteError(error);
  } catch (thrown) {
    return thrown;
  }
  throw new Error('mapCommissionWriteError did not throw');
}

describe('the bounded transaction timeout of a commission write', () => {
  it('becomes a retryable 409 instead of a 500', () => {
    const thrown = caughtBy(timeoutError());

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ code: 'TRANSACTION_RETRY_REQUIRED' });
    expect((thrown as ApiError).status).toBe(409);
  });
});

describe('the known commission write refusals', () => {
  it.each([
    [
      'a plan version refusal',
      new CommissionPlanVersionError('COMMISSION_PERIOD_CLOSED', { code: 'PLAN_INVALID' }),
      'COMMISSION_PERIOD_CLOSED',
    ],
    [
      'a statement pay refusal',
      new CommissionStatementPayError('COMMISSION_STATEMENT_NOT_APPROVED'),
      'COMMISSION_STATEMENT_NOT_APPROVED',
    ],
    [
      'a closed statement period',
      new StatementPeriodClosedError(['2026-10']),
      'COMMISSION_PERIOD_CLOSED',
    ],
    ['a reused idempotency key', new IdempotencyKeyReusedError(), 'IDEMPOTENCY_KEY_REUSED'],
    ['a busy idempotency key', new IdempotencyKeyBusyError(), 'IDEMPOTENCY_KEY_IN_PROGRESS'],
  ])('%s keeps its own code', (_label, error, code) => {
    const thrown = caughtBy(error);

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe(code);
  });
});

describe('an unknown commission write failure', () => {
  it.each([
    ['a plain error', new Error('connection reset')],
    ['a non-error value', 'not an error'],
    ['null', null],
    [
      'an unknown commit outcome',
      Object.assign(new Error('commit outcome unknown'), { name: 'CommitOutcomeUnknownError' }),
    ],
  ])('%s passes through unchanged', (_label, error) => {
    expect(caughtBy(error)).toBe(error);
  });
});
