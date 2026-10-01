import { afterAll, beforeAll, expect, it } from 'vitest';
import { PHONE, notificationHarness } from './harness.ts';

let h: Awaited<ReturnType<typeof notificationHarness>>;
beforeAll(async () => {
  h = await notificationHarness();
});
afterAll(async () => {
  await h.close();
});

it('tenant source JSON round-trips the phone; internal events retain only safe context', async () => {
  const event = await h.request();
  await h.deliver(event);
  const id = await h.attempt(event);
  expect(JSON.stringify(event.payload)).toContain(PHONE);
  expect((await h.read(id))?.['recipient_phone']).toBe(PHONE);
  await h.module.send.execute(event.companyId, id);
  const internal = (await h.events()).filter((e) => e.event_type.startsWith('Notification'));
  expect(internal).toHaveLength(2);
  const text = JSON.stringify(internal);
  for (const forbidden of [PHONE, 'recipient_hash', 'safe_parameters', 'test-key', 'test-token'])
    expect(text).not.toContain(forbidden);
  expect(await h.read(id)).toMatchObject({ recipient_phone: null, phone_last3: '001' });
});
