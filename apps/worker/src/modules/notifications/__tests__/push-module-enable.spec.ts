import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createInAppNotificationModule } from '../notifications.module.ts';
import { PUSH_USER, pushHarness, pushRecipient } from './push-harness.ts';

let h: Awaited<ReturnType<typeof pushHarness>>;
const SUBSCRIPTION = '01920000-0000-7000-8000-0000000000f1';

beforeAll(async () => {
  h = await pushHarness();
  await h.subscribe(TENANT.A.company, SUBSCRIPTION, PUSH_USER, 'ar');
});

afterAll(async () => {
  await h.close();
});

it('writes no push attempt while the push capability is off', async () => {
  const module = createInAppNotificationModule({
    database: h.db,
    ids: h.ids,
    clock: h.clock,
  });
  const event = await h.request([pushRecipient()]);
  await h.db.withTenant(event.companyId, (tx) => module.consumer.handle(tx, event));
  expect(await h.attempts(event.id)).toHaveLength(0);
  expect(await h.authorized(event.id)).toHaveLength(0);
});

it('writes one attempt per live subscription when the push capability is on', async () => {
  const module = createInAppNotificationModule({
    database: h.db,
    ids: h.ids,
    clock: h.clock,
    push: { enabled: true },
  });
  const event = await h.request([pushRecipient()]);
  await h.db.withTenant(event.companyId, (tx) => module.consumer.handle(tx, event));
  const rows = await h.attempts(event.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['subscription_id']).toBe(SUBSCRIPTION);
  expect(rows[0]?.['status']).toBe('PENDING');
  expect(await h.authorized(event.id)).toHaveLength(1);
});
