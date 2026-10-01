import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SendNotification } from '../use-cases/send-notification/send-notification.ts';
import { PHONE, notificationHarness } from './harness.ts';
import type { Attempt, TerminalResult } from '../domain/attempt-status.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
beforeAll(async () => {
  h = await notificationHarness();
});
afterAll(async () => {
  await h.close();
});

describe('crash after SENDING commit before provider call', () => {
  it('leaves unknown SENDING and no later execution makes a provider call', async () => {
    const event = await h.request();
    await h.deliver(event);
    const id = await h.attempt(event);
    const beforeCalls = h.channel.calls;
    Object.assign(h.channel.hooks, {
      beforeSubmission: async () => {
        throw new Error('CRASH_BEFORE_HTTP');
      },
    });
    await expect(h.module.send.execute(event.companyId, id)).rejects.toThrow('CRASH_BEFORE_HTTP');
    Object.assign(h.channel.hooks, { beforeSubmission: undefined });
    expect(h.channel.calls).toBe(beforeCalls);
    const sendingRow = await h.read(id);
    expect(sendingRow).toMatchObject({ status: 'SENDING', recipient_phone: PHONE });
    await h.module.send.execute(event.companyId, id);
    expect(h.channel.calls).toBe(beforeCalls);
    expect(await h.read(id)).toMatchObject({ status: 'SENDING' });
  });
});

describe('provider accepted but result not recorded', () => {
  it('stays SENDING and is never resubmitted on subsequent execution', async () => {
    const event = await h.request();
    await h.deliver(event);
    const id = await h.attempt(event);
    const failingFinishAttempts = {
      ...h.module.send.attempts,
      finish: async () => {
        throw new Error('CRASH_RESULT_COMMIT');
      },
    };
    const sendWithFailingFinish = new SendNotification(
      failingFinishAttempts,
      h.module.send.channel,
      h.module.send.admission,
      h.module.send.identity,
      h.module.send.configuration,
      h.module.send.clock,
      h.module.send.ids,
    );
    const beforeCalls = h.channel.calls;
    await expect(sendWithFailingFinish.execute(event.companyId, id)).rejects.toThrow(
      'CRASH_RESULT_COMMIT',
    );
    expect(h.channel.calls).toBe(beforeCalls + 1);
    const row = await h.read(id);
    expect(row).toMatchObject({ status: 'SENDING' });
    await h.module.send.execute(event.companyId, id);
    expect(h.channel.calls).toBe(beforeCalls + 1);
    expect(await h.read(id)).toMatchObject({ status: 'SENDING' });
  });
});

describe('result write failure', () => {
  it('retries only the result write and never Channel.send', async () => {
    const event = await h.request();
    await h.deliver(event);
    const id = await h.attempt(event);
    let finishAttempts = 0;
    const originalFinish = h.module.send.attempts.finish.bind(h.module.send.attempts);
    const retryAttempts = {
      ...h.module.send.attempts,
      finish: async (attempt: Attempt, result: TerminalResult, eventId: string, now: Date) => {
        finishAttempts += 1;
        if (finishAttempts === 1) {
          throw new Error('TRANSIENT_RESULT_WRITE_FAILURE');
        }
        return originalFinish(attempt, result, eventId, now);
      },
    };
    const sendWithRetry = new SendNotification(
      retryAttempts,
      h.module.send.channel,
      h.module.send.admission,
      h.module.send.identity,
      h.module.send.configuration,
      h.module.send.clock,
      h.module.send.ids,
    );
    const beforeCalls = h.channel.calls;
    await sendWithRetry.execute(event.companyId, id);
    expect(finishAttempts).toBe(2);
    expect(h.channel.calls).toBe(beforeCalls + 1);
    const finalRow = await h.read(id);
    expect(finalRow).toMatchObject({ status: 'SENT', recipient_phone: null });
    const events = (await h.events()).filter(
      (e) => e.payload['attempt_id'] === id && e.event_type === 'NotificationDelivered',
    );
    expect(events).toHaveLength(1);
  });
});
