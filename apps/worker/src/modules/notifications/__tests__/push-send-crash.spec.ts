import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { SendPush } from '../use-cases/send-push/send-push.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

it('leaves the attempt pending and sends nothing when the claim fails', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  const failing = new SendPush(
    {
      ...h.send.deliveries,
      claim: async () => {
        throw new Error('CRASH_CLAIM');
      },
    },
    h.send.builder,
    h.send.channel,
    h.send.admission,
    h.send.keyId,
    h.send.clock,
    h.send.ids,
  );
  await expect(failing.execute(TENANT.A.company, attemptId)).rejects.toThrow('CRASH_CLAIM');
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'PENDING', execution_id: null });
});

it('leaves the attempt sending and sends nothing when the request fails before the call', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  Object.assign(h.channel.hooks, {
    beforeSubmission: async () => {
      throw new Error('CRASH_BEFORE_HTTP');
    },
  });
  await expect(h.send.execute(TENANT.A.company, attemptId)).rejects.toThrow('CRASH_BEFORE_HTTP');
  Object.assign(h.channel.hooks, { beforeSubmission: undefined });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'SENDING' });
  await h.send.execute(TENANT.A.company, attemptId);
  expect(h.channel.calls).toBe(before);
});

it('keeps the attempt sending when the result cannot be written', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  const failing = new SendPush(
    {
      ...h.send.deliveries,
      finish: async () => {
        throw new Error('CRASH_RESULT_COMMIT');
      },
    },
    h.send.builder,
    h.send.channel,
    h.send.admission,
    h.send.keyId,
    h.send.clock,
    h.send.ids,
  );
  await expect(failing.execute(TENANT.A.company, attemptId)).rejects.toThrow('CRASH_RESULT_COMMIT');
  expect(h.channel.calls).toBe(before + 1);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'SENDING' });
  await h.send.execute(TENANT.A.company, attemptId);
  expect(h.channel.calls).toBe(before + 1);
});
