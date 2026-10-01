import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { NOW, PHONE, notificationHarness } from './harness.ts';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
beforeAll(async () => {
  h = await notificationHarness();
});
afterAll(async () => {
  await h.close();
});

describe('durable source authorization', () => {
  it('redelivery preserves one attempt, one authorization and one provider call', async () => {
    const event = await h.request();
    expect(await h.deliver(event)).toEqual({ delivered: true });
    const id = await h.attempt(event);
    expect((await h.read(id))?.['recipient_phone']).toBe(PHONE);
    await h.module.send.execute(TENANT.A.company, id);
    expect(await h.deliver(event)).toEqual({ delivered: true });
    // Also bypass consumer dedupe to prove the unique identity is authoritative.
    await h.db.withTenant(event.companyId, (tx) => h.module.consumer.handle(tx, event));
    await h.module.send.execute(TENANT.A.company, id);
    const rows = await h.db.withTenant(event.companyId, (tx) =>
      tx.execute(sql`SELECT id FROM notification_attempts WHERE source_event_id = ${event.id}`),
    );
    expect(rows).toHaveLength(1);
    expect(h.channel.calls).toBe(1);
    expect(
      (await h.events()).filter(
        (e) => e.event_type === 'NotificationSendAuthorized' && e.payload['attempt_id'] === id,
      ),
    ).toHaveLength(1);
  });

  it.each([
    [null, 'LOCALE_MISSING'],
    ['', 'LOCALE_MISSING'],
    ['fr', 'LOCALE_UNSUPPORTED'],
  ])('locale %s fails closed', async (locale, code) => {
    const calls = h.channel.calls;
    const event = await h.request({ locale });
    await h.deliver(event);
    const id = await h.attempt(event);
    await h.module.send.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({
      status: 'FAILED',
      failure_code: code,
      locale: null,
      recipient_phone: null,
    });
    expect(h.channel.calls).toBe(calls);
    expect(
      (await h.events()).filter((e) => e.payload['attempt_id'] === id).map((e) => e.event_type),
    ).toEqual(['NotificationFailed']);
  });

  it('expired authorization creates EXPIRED with no job and no provider call', async () => {
    const calls = h.channel.calls;
    const event = await h.request({ send_deadline: NOW.toISOString() });
    await h.deliver(event);
    const id = await h.attempt(event);
    await h.module.send.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({ status: 'EXPIRED', recipient_phone: null });
    expect(h.channel.calls).toBe(calls);
  });
});

describe('additional safety checks', () => {
  it('the reserved SUPPRESSED terminal state clears phone and creates no sender authorization', async () => {
    h.suppress();
    const calls = h.channel.calls;
    const event = await h.request();
    await h.deliver(event);
    const id = await h.attempt(event);
    await h.module.send.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({ status: 'SUPPRESSED', recipient_phone: null });
    expect(h.channel.calls).toBe(calls);
  });
  it('consumer rollback leaves no attempt or authorization', async () => {
    const event = await h.request();
    await expect(
      h.db.withTenant(event.companyId, async (tx) => {
        await h.module.consumer.handle(tx, event);
        throw new Error('test-rollback');
      }),
    ).rejects.toThrow('test-rollback');
    expect(
      await h.db.withTenant(event.companyId, (tx) =>
        tx.execute(sql`SELECT id FROM notification_attempts WHERE source_event_id = ${event.id}`),
      ),
    ).toHaveLength(0);
    expect(
      (await h.events()).filter((e) => e.payload['source_event_id'] === event.id),
    ).toHaveLength(0);
  });
});
