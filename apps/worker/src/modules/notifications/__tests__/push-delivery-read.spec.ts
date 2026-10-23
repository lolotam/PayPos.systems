import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createPushDeliveryRepository,
  pendingDeliveryStatement,
} from '../persistence/drizzle-push-delivery.repository.ts';
import { AUTH, ENDPOINT, KEY_ID, P256DH, PUSH_PARAMETERS, PUSH_USER } from './push-harness.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

it('maps the pending attempt and its subscription in one shape', async () => {
  const { attemptId, subscriptionId, deliveryToken, eventId } = await h.authorizeAttempt('ar');
  const delivery = await createPushDeliveryRepository(h.db).pending(TENANT.A.company, attemptId);
  expect(delivery).toEqual({
    attempt: {
      companyId: TENANT.A.company,
      id: attemptId,
      subscriptionId,
      subscriptionGeneration: 1,
      userId: PUSH_USER,
      businessId: TENANT.A.business,
      branchId: TENANT.A.branch,
      sourceEventId: eventId,
      templateKey: 'shift_not_clocked_in_self',
      templateRevision: 1,
      locale: 'ar',
      safeParameters: PUSH_PARAMETERS,
      status: 'PENDING',
      deadline: null,
      executionId: null,
      sendingAt: null,
    },
    subscription: {
      generation: 1,
      vapidKeyId: KEY_ID,
      revokedAt: null,
      endpoint: ENDPOINT,
      p256dh: P256DH,
      auth: AUTH,
      deliveryToken,
    },
  });
});

it('returns nothing for an attempt that is not pending any more', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const repository = createPushDeliveryRepository(h.db);
  const delivery = await repository.pending(TENANT.A.company, attemptId);
  if (delivery === null) throw new Error('TEST_DELIVERY_MISSING');
  await repository.claim(
    delivery,
    '01920000-0000-7000-8000-0000000000a9',
    new Date('2026-10-01T10:00:00Z'),
  );
  expect(await repository.pending(TENANT.A.company, attemptId)).toBeNull();
});

it('reads the attempt through an index and never scans the table', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const plan = await h.db.withTenant(TENANT.A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${pendingDeliveryStatement(attemptId)}`);
  });
  const text = JSON.stringify(plan);
  expect(text).toMatch(/Index Scan|Index Only Scan|Bitmap Index Scan/);
  expect(text).toMatch(/push_attempts_pkey|push_subscriptions_(pkey|company_id_id_idx)/);
  expect(text).not.toContain('Seq Scan');
});
