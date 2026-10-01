import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, notificationHarness } from './harness.ts';
import { SendNotification } from '../use-cases/send-notification/send-notification.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
beforeAll(async () => {
  h = await notificationHarness();
});
afterAll(async () => {
  await h.close();
});

describe('irrevocable execution fence', () => {
  it('two competing processors submit at most once', async () => {
    const event = await h.request();
    await h.deliver(event);
    const id = await h.attempt(event);
    await Promise.all([
      h.module.send.execute(event.companyId, id),
      h.module.send.execute(event.companyId, id),
    ]);
    expect(h.channel.calls).toBe(1);
    expect(await h.read(id)).toMatchObject({
      status: 'SENT',
      recipient_phone: null,
      provider_message_id: 'fake-message-id',
    });
    expect(
      (await h.events()).filter(
        (e) => e.payload['attempt_id'] === id && e.event_type === 'NotificationDelivered',
      ),
    ).toMatchObject([{ payload: { evidence: 'PROVIDER_ACCEPTED' } }]);
  });

  it.each(['4xx', '429', '5xx', 'timeout'] as const)(
    '%s records terminal FAILED and clears phone without resending',
    async (outcome) => {
      h.channel.outcome = outcome;
      const before = h.channel.calls;
      const event = await h.request();
      await h.deliver(event);
      const id = await h.attempt(event);
      await h.module.send.execute(event.companyId, id);
      await h.module.send.execute(event.companyId, id);
      expect(h.channel.calls).toBe(before + 1);
      expect(await h.read(id)).toMatchObject({
        status: 'FAILED',
        recipient_phone: null,
        outcome_known: outcome === '4xx' || outcome === '429',
      });
    },
  );
});

describe('additional safety checks', () => {
  it('an unknown SENDING commit acknowledgement grants no send permission, even after the write committed', async () => {
    const event = await h.request();
    await h.deliver(event);
    const id = await h.attempt(event);
    const sender = h.module.send;
    const uncertain = {
      ...sender.attempts,
      claim: async (...args: Parameters<typeof sender.attempts.claim>) => {
        await sender.attempts.claim(...args);
        throw Object.assign(new Error('test-unknown-commit'), {
          name: 'CommitOutcomeUnknownError',
        });
      },
    };
    const send = new SendNotification(
      uncertain,
      sender.channel,
      sender.admission,
      sender.identity,
      sender.configuration,
      sender.clock,
      sender.ids,
    );
    const before = h.channel.calls;
    await expect(send.execute(event.companyId, id)).rejects.toMatchObject({
      name: 'CommitOutcomeUnknownError',
    });
    await sender.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({ status: 'SENDING' });
    expect(h.channel.calls).toBe(before);
  });
});

describe('terminal and deadline safety', () => {
  it('deadline advancing after authorization records EXPIRED without submission', async () => {
    const before = h.channel.calls;
    const event = await h.request({ send_deadline: new Date(NOW.getTime() + 1_000).toISOString() });
    await h.deliver(event);
    const id = await h.attempt(event);
    h.advance(new Date(NOW.getTime() + 1_000));
    await h.module.send.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({ status: 'EXPIRED', recipient_phone: null });
    expect(h.channel.calls).toBe(before);
    h.advance(NOW);
  });

  it('deadline advancing inside channel before HTTP expires an already claimed execution', async () => {
    const before = h.channel.calls;
    const event = await h.request({ send_deadline: new Date(NOW.getTime() + 1_000).toISOString() });
    await h.deliver(event);
    const id = await h.attempt(event);
    Object.assign(h.channel.hooks, {
      beforeSubmission: async () => {
        h.advance(new Date(NOW.getTime() + 1_000));
      },
    });
    await h.module.send.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({ status: 'EXPIRED', recipient_phone: null });
    expect(h.channel.calls).toBe(before);
    Object.assign(h.channel.hooks, { beforeSubmission: undefined });
    h.advance(NOW);
  });
});

describe('one moment for the deadline check and the claim', () => {
  it('a deadline reached between the check and the claim cannot leave the attempt PENDING', async () => {
    const event = await h.request({ send_deadline: new Date(NOW.getTime() + 1_000).toISOString() });
    await h.deliver(event);
    const id = await h.attempt(event);
    const original = h.clock.now;
    let calls = 0;
    // The first two readings are before the deadline, every later one is at it: a sender that reads the
    // clock again for the claim would pass the check and then be refused by the claim.
    h.clock.now = () => new Date(++calls <= 2 ? NOW.getTime() : NOW.getTime() + 1_000);
    try {
      await h.module.send.execute(event.companyId, id);
    } finally {
      h.clock.now = original;
    }
    const row = await h.read(id);
    expect(row?.status).not.toBe('PENDING');
    expect(row).toMatchObject({ recipient_phone: null });
  });
});
