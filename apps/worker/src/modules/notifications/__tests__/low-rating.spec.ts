import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  OTHER_INBOX_USER,
  seedInboxUsers,
} from '../../../../../../packages/db/test/in-app-fixtures.ts';
import { notificationHarness } from './harness.ts';

const ids = systemUuidV7();
let h: Awaited<ReturnType<typeof notificationHarness>>;
let owner: postgres.Sql;

const details = {
  stars: 2,
  branch_name_ar: 'السالمية',
  branch_name_en: 'Salmiya',
  business_date: '2026-11-07',
  performers: [
    { name_ar: 'ليلى', name_en: 'Laila' },
    { name_ar: null, name_en: 'Mona' },
  ],
  customer_name: 'Synthetic customer',
  phone_last3: '123',
};

beforeAll(async () => {
  h = await notificationHarness();
  owner = postgres(h.testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedInboxUsers(owner);
});
afterAll(async () => {
  await owner.end();
  await h.close();
});

function lowRatingReceived(recipients: readonly unknown[]): ClaimedEvent {
  return {
    id: ids.newId(),
    companyId: TENANT.A.company,
    aggregateType: 'rating',
    aggregateId: ids.newId(),
    eventType: 'LowRatingReceived',
    payload: {
      business_id: TENANT.A.business,
      branch_id: TENANT.A.branch,
      notification_recipients: recipients,
    },
    attempt: 1,
  };
}

function bell(user: string, key: 'low_rating' | 'low_rating_with_comment', value: object) {
  return {
    channel: 'IN_APP',
    user_id: user,
    locale: 'ar',
    template_key: key,
    template_revision: 1,
    safe_parameters: [{ name: 'details', type: 'details', value }],
  };
}

it('stores one inbox row per recipient with the details object as sent', async () => {
  const commented = { ...details, comment: 'الخدمة اتأخرت' };
  const request = lowRatingReceived([
    bell(USER, 'low_rating', details),
    bell(OTHER_INBOX_USER, 'low_rating_with_comment', commented),
  ]);
  expect(await h.deliver(request)).toEqual({ delivered: true });
  const rows = await owner`SELECT recipient_user_id,template_key,template_revision,locale,
      business_id,branch_id,safe_parameters FROM in_app_notifications
    WHERE source_event_id = ${request.id} ORDER BY template_key`;
  expect(rows).toEqual([
    {
      recipient_user_id: USER,
      template_key: 'low_rating',
      template_revision: 1,
      locale: 'ar',
      business_id: TENANT.A.business,
      branch_id: TENANT.A.branch,
      safe_parameters: [{ name: 'details', type: 'details', value: details }],
    },
    {
      recipient_user_id: OTHER_INBOX_USER,
      template_key: 'low_rating_with_comment',
      template_revision: 1,
      locale: 'ar',
      business_id: TENANT.A.business,
      branch_id: TENANT.A.branch,
      safe_parameters: [{ name: 'details', type: 'details', value: commented }],
    },
  ]);
});

it.each([
  ['a comment in low_rating', bell(USER, 'low_rating', { ...details, comment: 'x' })],
  ['no comment in low_rating_with_comment', bell(USER, 'low_rating_with_comment', details)],
  ['an unknown details key', bell(USER, 'low_rating', { ...details, rating_id: USER })],
  ['three stars', bell(USER, 'low_rating', { ...details, stars: 3 })],
])('refuses %s with NOTIFICATION_REQUEST_INVALID and stores nothing', async (_label, recipient) => {
  const request = lowRatingReceived([recipient]);
  await expect(
    h.db.withTenant(request.companyId, (tx) => h.module.consumer.handle(tx, request)),
  ).rejects.toThrow('NOTIFICATION_REQUEST_INVALID');
  expect((await h.deliver(request)).delivered).toBe(false);
  expect(
    await owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${request.id}`,
  ).toHaveLength(0);
});
