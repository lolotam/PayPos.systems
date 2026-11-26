import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { NOW } from './push-harness.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// معاملة كتابة ما اتثبتتش بعد: بتغيّر الاشتراك وتفضل مفتوحة لحد ما الاختبار يسمح بالـ COMMIT.
function openWriter(statement: SQL) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let changed: () => void = () => undefined;
  const written = new Promise<void>((resolve) => {
    changed = resolve;
  });
  const done = h.db.withTenant(TENANT.A.company, async (tx) => {
    await tx.execute(statement);
    changed();
    await gate;
  });
  return { written, release, done };
}

const cases: readonly { name: string; statement: (subscriptionId: string) => SQL }[] = [
  {
    name: 'registration that bumps the generation',
    statement: (
      id,
    ) => sql`UPDATE push_subscriptions SET generation = generation + 1, updated_at = now()
      WHERE company_id = app_company_id() AND id = ${id}`,
  },
  {
    name: 'revocation',
    statement: (
      id,
    ) => sql`UPDATE push_subscriptions SET revoked_at = now(), revoked_reason = 'GONE',
      endpoint = NULL, p256dh = NULL, auth = NULL, delivery_token = NULL, generation = generation + 1,
      updated_at = now() WHERE company_id = app_company_id() AND id = ${id}`,
  },
];

it.each(cases)(
  'claim waits for an uncommitted $name and then refuses the stale generation',
  async ({ statement }) => {
    const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
    const delivery = await h.send.deliveries.pending(TENANT.A.company, attemptId);
    if (delivery === null) throw new Error('TEST_DELIVERY_MISSING');
    const writer = openWriter(statement(subscriptionId));
    await writer.written;

    let settled = false;
    const claiming = h.send.deliveries.claim(delivery, h.ids.newId(), NOW).finally(() => {
      settled = true;
    });
    await wait(500);
    expect(settled).toBe(false);
    expect((await h.attempt(attemptId))[0]?.['status']).toBe('PENDING');

    writer.release();
    await writer.done;
    expect(await claiming).toBe(false);
    const [row] = await h.attempt(attemptId);
    expect(row).toMatchObject({ status: 'PENDING', execution_id: null });
  },
);
