import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createPushAttemptsRepository,
  liveSubscriptionsStatement,
} from '../persistence/drizzle-push-attempts.repository.ts';
import { PUSH_USER, pushHarness } from './push-harness.ts';

let h: Awaited<ReturnType<typeof pushHarness>>;
const AR = '01920000-0000-7000-8000-0000000000f1';
const EN = '01920000-0000-7000-8000-0000000000f2';
const REVOKED = '01920000-0000-7000-8000-0000000000f3';

beforeAll(async () => {
  h = await pushHarness();
  await h.subscribe(TENANT.A.company, AR, PUSH_USER, 'ar');
  await h.subscribe(TENANT.A.company, EN, PUSH_USER, 'en');
  await h.subscribeRevoked(TENANT.A.company, REVOKED, PUSH_USER);
});

afterAll(async () => {
  await h.close();
});

it('returns the live subscriptions of the user in creation order', async () => {
  const rows = await h.db.withTenant(TENANT.A.company, async (tx) =>
    createPushAttemptsRepository(tx).liveSubscriptions(PUSH_USER),
  );
  expect(rows).toEqual([
    { id: AR, locale: 'ar', generation: 1 },
    { id: EN, locale: 'en', generation: 1 },
  ]);
});

it('the lookup plan reads the user through an index and never scans the table', async () => {
  const plan = await h.db.withTenant(TENANT.A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${liveSubscriptionsStatement(PUSH_USER)}`);
  });
  const text = JSON.stringify(plan);
  expect(text).toMatch(/Index Scan|Index Only Scan|Bitmap Index Scan/);
  expect(text).toMatch(/push_subscriptions_(active_user_idx|user_idx)/);
  expect(text).not.toContain('Seq Scan');
});
