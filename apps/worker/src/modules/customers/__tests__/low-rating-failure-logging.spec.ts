import { Writable } from 'node:stream';
import type { ClaimedEvent, Database, Tx } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { retryDelayMs } from '../../../outbox/retry-policy.ts';
import { WORKER_LOG_EVENTS } from '../../../shared/log-events.ts';

const MARKER = 'COMMENT_MARKER_call_55512345';
const EVENT: ClaimedEvent = {
  id: '01920000-0000-7000-8000-0000000000e1',
  companyId: '01920000-0000-7000-8000-0000000000a0',
  aggregateType: 'rating',
  aggregateId: '01920000-0000-7000-8000-0000000000e2',
  eventType: 'LowRatingSubmitted',
  payload: {},
  attempt: 1,
};

/** خطأ بنفس شكل خطأ postgres.js عند فشل كتابة صف الـ outbox: الرسالة والتفصيل والسبب والمعاملات كلها تحمل نص التعليق. */
function commentBearingDriverError(): Error {
  return Object.assign(
    new Error(`new row for relation "outbox" violates check constraint: ${MARKER}`),
    {
      name: 'PostgresError',
      code: '23514',
      detail: `Failing row contains (..., {"comment": "${MARKER}"})`,
      where: `JSON data: ${MARKER}`,
      parameters: [MARKER],
      query: `insert into outbox ... values ('${MARKER}')`,
      cause: new Error(MARKER),
    },
  );
}

it('a comment-bearing outbox write failure reaches neither the logs nor the stored last_error', async () => {
  let logs = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logs += String(chunk);
      done();
    },
  });
  const logger = createLogger('info', { destination: sink, events: WORKER_LOG_EVENTS });
  const app: Pick<Database, 'withTenant'> = {
    withTenant: async (_companyId, work) =>
      work({ execute: async () => [{ first: 1 }] } as unknown as Tx),
  };
  const writer: OutboxConsumer = {
    id: 'customers.low-rating-notice',
    eventTypes: ['LowRatingSubmitted'],
    handle: async () => {
      throw commentBearingDriverError();
    },
  };
  const outcome = await createDeliverer(app, [writer], logger, { knownEventTypes: [] })(EVENT);
  expect(outcome).toMatchObject({
    delivered: false,
    error: 'PostgresError',
    retryInMs: retryDelayMs(1),
  });
  expect(JSON.stringify(outcome)).not.toContain(MARKER);
  expect(logs).toContain('outbox delivery failed');
  expect(logs).not.toContain(MARKER);
  expect(logs).not.toContain('55512345');
});
