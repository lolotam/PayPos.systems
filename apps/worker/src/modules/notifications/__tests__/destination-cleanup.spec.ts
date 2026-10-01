import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { NOW, PHONE, notificationHarness } from './harness.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
beforeAll(async () => {
  h = await notificationHarness();
});
afterAll(async () => {
  await h.close();
});

it('crashed SENDING cannot resend; explicit drained cleanup after 24h clears only destination', async () => {
  h.channel.outcome = 'crash';
  const event = await h.request();
  await h.deliver(event);
  const id = await h.attempt(event);
  await expect(h.module.send.execute(event.companyId, id)).rejects.toThrow('FAKE_EXECUTION_CRASH');
  const before = await h.read(id);
  expect(before).toMatchObject({ status: 'SENDING', recipient_phone: PHONE });
  const input = {
    company_id: event.companyId,
    attempt_id: id,
    execution_id: String(before?.['execution_id']),
    operator_id: USER,
    execution_stopped: true,
  };
  expect(await h.module.cleanup(input)).toBe(false);
  h.advance(new Date(NOW.getTime() + 24 * 60 * 60 * 1_000));
  await expect(h.module.cleanup({ ...input, execution_stopped: false })).rejects.toThrow(
    'NOTIFICATION_CLEANUP_INVALID',
  );
  expect(await h.module.cleanup(input)).toBe(true);
  const after = await h.read(id);
  expect(after).toMatchObject({
    status: 'SENDING',
    recipient_phone: null,
    execution_id: before?.['execution_id'],
    recipient_hash: before?.['recipient_hash'],
  });
  await h.module.send.execute(event.companyId, id);
  expect(h.channel.calls).toBe(1);
  expect(
    (await h.events()).filter((e) =>
      ['NotificationDelivered', 'NotificationFailed'].includes(e.event_type),
    ),
  ).toHaveLength(0);
});
