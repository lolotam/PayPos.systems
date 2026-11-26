// تسجيل فشل مجدول طلبات التقييم: لقط السجل الحقيقي، واثبات إن مفيش سر بيعدّي.
import { expect, it, vi } from 'vitest';

import { Queue } from 'bullmq';

import { ClaimRatingRequests } from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';
import {
  COMPANY,
  FakeState,
} from '../../modules/customers/use-cases/claim-rating-requests/__tests__/claim-rating-requests.fixture.ts';
import { ratingClaimDiagnostics } from '../../modules/customers/persistence/rating-claim-diagnostics.ts';
import {
  capture,
  jobHarness,
  next,
  noopTurn,
  PHONE,
  RAW,
  REDIS_CREDENTIALS,
  secretBearingError,
  TOKEN,
  triggerEvent,
} from './rating-claims-logging.fixture.ts';

let counter = 0;
const ids = { newId: () => `01920000-0000-7000-8000-${String(counter++).padStart(12, '0')}` };

it('an escaping upper id failure is reported with the company and no message', async () => {
  const cap = capture();
  const turn = new ClaimRatingRequests(
    {
      state: new FakeState(),
      transactions: {
        upperId: async () => {
          throw secretBearingError();
        },
        pageIds: async () => [],
        withRequest: async (_companyId, _requestId, work) => work({}, null),
      },
      requests: { findRequest: async () => null },
      claim: { execute: async () => 'CLAIMED' as const },
      diagnostics: ratingClaimDiagnostics(cap.logger),
    },
    ids,
    { now: () => new Date('2026-11-01T08:00:00.000Z') },
  );
  await expect(turn.execute(COMPANY)).rejects.toThrow('SYNTHETIC_UPPER_ID_FAILURE');
  const failure = cap.lines().find((line) => line['msg'] === 'error');
  expect(failure).toMatchObject({ company_id: COMPANY, failure: { type: 'PostgresError' } });
});

it('a registration failure is logged with the company, the event and the attempt', async () => {
  const cap = capture();
  const harness = jobHarness(cap.logger, noopTurn());
  const spy = vi
    .spyOn(Queue.prototype, 'upsertJobScheduler')
    .mockRejectedValue(new Error('SYNTHETIC_REGISTRATION_FAILURE'));
  const event = triggerEvent(3);
  try {
    expect(await harness.processor.deliver(event, next)).toEqual({
      delivered: false,
      error: 'RATING_CLAIMS_SCHEDULE_RETRY',
      retryInMs: 20_000,
    });
    const line = cap.lines().find((entry) => entry['msg'] === 'rating claims schedule failed');
    expect(line).toMatchObject({
      company_id: COMPANY,
      event_id: event.id,
      event_type: 'ServiceSessionRecorded',
      attempt: 3,
    });
    expect(cap.logs()).not.toContain('log message withheld');
  } finally {
    spy.mockRestore();
    await harness.close();
  }
});

it('a failed claim job is logged with the company and the job identity', async () => {
  const cap = capture();
  const harness = jobHarness(cap.logger, {
    execute: async () => {
      throw secretBearingError();
    },
  });
  try {
    const job = await harness.queue.add('claim', { companyId: COMPANY }, { attempts: 1 });
    await vi.waitFor(
      () =>
        expect(cap.lines().some((line) => line['msg'] === 'rating claims job failed')).toBe(true),
      { timeout: 20_000 },
    );
    const line = cap.lines().find((entry) => entry['msg'] === 'rating claims job failed');
    expect(line).toMatchObject({ company_id: COMPANY, job_id: job.id });
    expect(line?.['attempts_made']).toBeGreaterThanOrEqual(1);
  } finally {
    await harness.close();
  }
});

it('a failed job with unreadable data is logged without a guessed company', async () => {
  const cap = capture();
  const harness = jobHarness(cap.logger, noopTurn());
  try {
    await harness.queue.add(
      'claim',
      { companyId: COMPANY, rating_token: TOKEN, payload: RAW, phone: PHONE },
      { attempts: 1 },
    );
    await vi.waitFor(
      () =>
        expect(cap.lines().some((line) => line['msg'] === 'rating claims job failed')).toBe(true),
      { timeout: 20_000 },
    );
    const line = cap.lines().find((entry) => entry['msg'] === 'rating claims job failed');
    expect(line?.['company_id']).toBeUndefined();
  } finally {
    await harness.close();
  }
});

it('a connection-wide failure is logged without a company', async () => {
  const cap = capture();
  const harness = jobHarness(cap.logger, noopTurn(), 'redis://127.0.0.1:1');
  try {
    await vi.waitFor(
      () =>
        expect(cap.lines().some((line) => line['msg'] === 'rating claims queue error')).toBe(true),
      { timeout: 20_000 },
    );
    for (const line of cap.lines()) expect(line['company_id']).toBeUndefined();
  } finally {
    await harness.close();
  }
});

it('no phone, token, password, redis credential or raw payload reaches the logs', async () => {
  const cap = capture();
  const harness = jobHarness(cap.logger, {
    execute: async () => {
      throw secretBearingError();
    },
  });
  try {
    await harness.queue.add(
      'claim',
      { companyId: COMPANY, rating_token: TOKEN, payload: RAW, phone: PHONE },
      { attempts: 1 },
    );
    await vi.waitFor(
      () =>
        expect(cap.lines().some((line) => line['msg'] === 'rating claims job failed')).toBe(true),
      { timeout: 20_000 },
    );
    const logs = cap.logs();
    for (const secret of [PHONE, TOKEN, 'supersecret', REDIS_CREDENTIALS, RAW]) {
      expect(logs).not.toContain(secret);
    }
  } finally {
    await harness.close();
  }
});
