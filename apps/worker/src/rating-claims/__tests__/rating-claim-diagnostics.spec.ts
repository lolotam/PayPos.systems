import { expect, it } from 'vitest';
import { createLogger } from '@pospay/observability';
import { ratingClaimDiagnostics } from '../../modules/customers/persistence/rating-claim-diagnostics.ts';
import type { RatingClaimDiagnostics } from '../../modules/customers/ports/rating-claim-diagnostics.port.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000b2';
const SWEEP = '01920000-0000-7000-8000-0000000000aa';

/** بيلقط سطر السجل اللي التشخيص كتبه، عشان نفحص اللي اتكتب فيه. */
function capture(
  level: 'info' | 'warn' | 'error',
  write: (diagnostics: RatingClaimDiagnostics) => void,
): string {
  let output = '';
  const logger = createLogger(level, {
    destination: {
      write: (line) => {
        output += line;
      },
    },
  });
  write(ratingClaimDiagnostics(logger));
  return output;
}

it('records safe failure diagnostics without messages or private request data', () => {
  let output = '';
  const logger = createLogger('error', {
    destination: {
      write: (line) => {
        output += line;
      },
    },
  });
  const companyId = '01920000-0000-7000-8000-0000000000b2';
  ratingClaimDiagnostics(logger).failed(
    companyId,
    new Error('private synthetic query +999999900001 redis:rating:1'),
  );
  expect(JSON.parse(output)).toMatchObject({
    company_id: companyId,
    code: 'RATING_CLAIM_REQUEST_RETRY',
    failure: { type: 'Error' },
  });
  expect(output).not.toMatch(/private|999999900001|redis:rating/);
  expect(output.trim().split('\n')).toHaveLength(1);
});

// الفيضان: العدّاد وأقدم استحقاق وآخر جولة كاملة وعلم المصالحة، من غير معرّف طلب.
it('records the overflow counters and the oldest retry age', () => {
  const output = capture('warn', (diagnostics) =>
    diagnostics.overflow(COMPANY, {
      overflowCount: 3,
      oldestRetryEligibleAt: 1_000,
      now: 61_000,
      lastCompletedSweepId: SWEEP,
      reconcileRequired: true,
    }),
  );
  expect(JSON.parse(output)).toMatchObject({
    company_id: COMPANY,
    code: 'RATING_CLAIMS_OVERFLOW',
    overflow_count: 3,
    oldest_retry_age_ms: 60_000,
    reconcile_required: true,
  });
  expect(output).not.toMatch(/request_id|requestId/);
});

it('reports no retry age when the retry map is empty', () => {
  const output = capture('warn', (diagnostics) =>
    diagnostics.overflow(COMPANY, {
      overflowCount: 1,
      oldestRetryEligibleAt: null,
      now: 61_000,
      reconcileRequired: false,
    }),
  );
  expect(JSON.parse(output)).toMatchObject({ oldest_retry_age_ms: null });
});

// فقد السور: رمز الرد بس، من غير أي تفاصيل تانية.
it('records fence loss with the reply code only', () => {
  const output = capture('warn', (diagnostics) => diagnostics.fenceLost(COMPANY, 'STALE'));
  expect(JSON.parse(output)).toMatchObject({
    company_id: COMPANY,
    code: 'RATING_CLAIMS_FENCE_LOST',
    state_code: 'STALE',
  });
  expect(output).not.toMatch(/request_id|sweep_id|token/);
});

// ملخص الدور: أعداد التسويات وسبب الانتهاء، من غير أي معرّف طلب أو جولة.
it('records the turn summary with counts and no identifiers', () => {
  const output = capture('info', (diagnostics) =>
    diagnostics.turnSummary(COMPANY, {
      settlements: { TERMINAL: 1, ABSENT: 0, FUTURE_UNATTEMPTED: 2, RETRY: 3, DELEGATED: 0 },
      forwardVisits: 5,
      retryVisits: 2,
      end: 'COMPLETED',
    }),
  );
  expect(JSON.parse(output)).toMatchObject({
    company_id: COMPANY,
    code: 'RATING_CLAIMS_TURN',
    end: 'COMPLETED',
    forward_visits: 5,
    retry_visits: 2,
    settlements: { TERMINAL: 1, FUTURE_UNATTEMPTED: 2, RETRY: 3 },
  });
  expect(output).not.toMatch(/request_id|sweep_id|requestId/);
});
