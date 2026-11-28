import { expect, it } from 'vitest';
import { runRatingBootstrap } from '../bootstrap-rating-requests.ts';
import { SessionRequestDayMismatchError } from '../../use-cases/schedule-rating-request/schedule-rating-request.ts';

it('retries the transaction once with persistedDay when SessionRequestDayMismatchError is thrown', async () => {
  const companyId = '01920000-0000-7000-8000-0000000000b2';
  const sessionId = '01920000-0000-7000-8000-0000000000f6';
  const attempts: (string | null | undefined)[] = [];
  let count = 0;

  const result = await runRatingBootstrap(
    {
      db: {
        withTenant: async (_cid, work) => work({} as never),
      },
      daySessions: {
        activeLines: async () => [],
        sessionsSince: async (_tx, _cid, _range, afterSessionId) =>
          afterSessionId === null
            ? [
                {
                  sessionId,
                  businessId: '01920000-0000-7000-8000-0000000000c3',
                  customerId: '01920000-0000-7000-8000-0000000000e5',
                  branchId: '01920000-0000-7000-8000-0000000000d4',
                  occurredAt: new Date('2026-10-05T10:00:00Z'),
                  recordedAt: new Date('2026-10-05T10:05:00Z'),
                  requestDay: null,
                },
              ]
            : [],
        countSince: async () => 1,
        watermark: async () => sessionId,
      },
      schedule: {
        execute: async (_tx, input) => {
          attempts.push(input.requestDay);
          expect(input.recordedAt).toEqual(new Date('2026-10-05T10:05:00Z'));
          count += 1;
          if (count === 1)
            throw new SessionRequestDayMismatchError(sessionId, '2026-10-05', '2026-10-04');
          return 'SCHEDULED';
        },
      },
      clock: { now: () => new Date('2026-10-05T12:00:00Z') },
      log: () => undefined,
    },
    { companyId, cutoff: new Date('2026-10-04T00:00:00Z') },
  );

  expect(result.complete).toBe(true);
  expect(attempts).toEqual([null, '2026-10-04']);
});
