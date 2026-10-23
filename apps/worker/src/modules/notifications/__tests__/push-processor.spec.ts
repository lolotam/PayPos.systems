import type { Logger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { pushProcessor } from '../jobs/push-send.processor.ts';
import type { PushSendOutcome } from '../use-cases/send-push/send-push.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a1';
const ATTEMPT = '01920000-0000-7000-8000-0000000000b1';
const SUBSCRIPTION = '01920000-0000-7000-8000-0000000000c1';

interface LogCall {
  readonly level: string;
  readonly object: unknown;
  readonly message: string;
}

function spyLogger() {
  const calls: LogCall[] = [];
  const logger = {
    info: (object: unknown, message: string) => {
      calls.push({ level: 'info', object, message });
    },
    warn: (object: unknown, message: string) => {
      calls.push({ level: 'warn', object, message });
    },
  };
  return { calls, logger: logger as unknown as Logger };
}

const outcome = (over: Partial<PushSendOutcome> = {}): PushSendOutcome => ({
  attemptId: ATTEMPT,
  subscriptionId: SUBSCRIPTION,
  status: 'SENT',
  failureCode: null,
  httpStatus: 201,
  vapidRejected: false,
  ...over,
});

const job = { data: { company_id: COMPANY, attempt_id: ATTEMPT } };

it('invalid job data is refused and the attempt is never executed', async () => {
  const { calls, logger } = spyLogger();
  let executed = 0;
  const processor = pushProcessor(
    {
      execute: async () => {
        executed += 1;
        return null;
      },
    },
    logger,
  );
  await expect(processor({ data: { company_id: 'nope' } })).rejects.toThrow('PUSH_JOB_INVALID');
  expect(executed).toBe(0);
  expect(calls).toHaveLength(0);
});

it('a failure of the attempt is hidden behind a bounded reason', async () => {
  const { logger } = spyLogger();
  const processor = pushProcessor(
    {
      execute: async () => {
        throw new Error('postgres://user:secret-password@host:5432/db');
      },
    },
    logger,
  );
  let error: Error | undefined;
  try {
    await processor(job);
  } catch (thrown) {
    error = thrown as Error;
  }
  expect(error?.message).toBe('PUSH_PROCESSING_FAILED');
  expect(error?.message).not.toContain('secret-password');
  expect(error?.cause).toBeUndefined();
});

it('an outcome is logged with the five fields and nothing else', async () => {
  const { calls, logger } = spyLogger();
  const processor = pushProcessor({ execute: async () => outcome() }, logger);
  await processor(job);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.level).toBe('info');
  expect(calls[0]?.message).toBe('push attempt finished');
  expect(calls[0]?.object).toEqual({
    push: {
      attemptId: ATTEMPT,
      subscriptionId: SUBSCRIPTION,
      status: 'SENT',
      failureCode: null,
      httpStatus: 201,
    },
  });
});

it('a rejected VAPID key adds the one warn line', async () => {
  const { calls, logger } = spyLogger();
  const processor = pushProcessor(
    {
      execute: async () =>
        outcome({
          status: 'FAILED',
          failureCode: 'PROVIDER_4XX',
          httpStatus: 401,
          vapidRejected: true,
        }),
    },
    logger,
  );
  await processor(job);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.level).toBe('warn');
  expect(calls[1]?.message).toBe('push provider rejected the VAPID key');
  expect(calls[1]?.object).toEqual({
    capability: { name: 'STAFF_PUSH', outcome: 'VAPID_REJECTED' },
  });
});

it('a null outcome logs nothing', async () => {
  const { calls, logger } = spyLogger();
  const processor = pushProcessor({ execute: async () => null }, logger);
  await processor(job);
  expect(calls).toHaveLength(0);
});
