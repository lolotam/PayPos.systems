import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  AUTH,
  ENDPOINT,
  OTHER_USER,
  P256DH,
  PUSH_PARAMETERS,
  PUSH_USER,
  pushHarness,
  pushRecipient,
} from './push-harness.ts';

let h: Awaited<ReturnType<typeof pushHarness>>;
const AR = '01920000-0000-7000-8000-0000000000e1';
const EN = '01920000-0000-7000-8000-0000000000e2';
const REVOKED = '01920000-0000-7000-8000-0000000000e3';
const OTHER = '01920000-0000-7000-8000-0000000000e4';
const FOREIGN = '01920000-0000-7000-8000-0000000000e5';
let tokenAr = '';
let tokenEn = '';

beforeAll(async () => {
  h = await pushHarness();
  tokenAr = await h.subscribe(TENANT.A.company, AR, PUSH_USER, 'ar');
  tokenEn = await h.subscribe(TENANT.A.company, EN, PUSH_USER, 'en');
  await h.subscribeRevoked(TENANT.A.company, REVOKED, PUSH_USER);
  await h.subscribe(TENANT.A.company, OTHER, OTHER_USER, 'ar');
  await h.subscribe(TENANT.B.company, FOREIGN, PUSH_USER, 'ar');
});

afterAll(async () => {
  await h.close();
});

it('writes one pending attempt per live subscription and one authorization event for each', async () => {
  const event = await h.request([pushRecipient()]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  const rows = await h.attempts(event.id);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row['locale']).sort()).toEqual(['ar', 'en']);
  expect(rows.map((row) => row['subscription_id']).sort()).toEqual([AR, EN].sort());
  expect(rows.every((row) => row['status'] === 'PENDING')).toBe(true);
  expect(rows.every((row) => row['subscription_generation'] === 1)).toBe(true);
  expect(
    rows.every(
      (row) =>
        row['failure_code'] === null &&
        row['outcome_known'] === null &&
        row['finished_at'] === null &&
        row['execution_id'] === null,
    ),
  ).toBe(true);
  expect(rows.every((row) => row['user_id'] === PUSH_USER)).toBe(true);
  expect(rows.every((row) => row['business_id'] === TENANT.A.business)).toBe(true);
  expect(rows.every((row) => row['branch_id'] === TENANT.A.branch)).toBe(true);
  const events = await h.authorized(event.id);
  expect(events).toHaveLength(2);
  expect(events.every((row) => row['event_type'] === 'PushSendAuthorized')).toBe(true);
  expect(await h.inbox(event.id)).toHaveLength(0);
  expect(await h.phoneAttempts(event.id)).toHaveLength(0);
});

it('stores the safe parameters as sent and never a secret of the subscription', async () => {
  const event = await h.request([pushRecipient()]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  const rows = await h.attempts(event.id);
  for (const row of rows) {
    const parameters = row['safe_parameters'] as { name: string; value: string }[];
    expect(parameters.map((parameter) => [parameter.name, parameter.value])).toEqual([
      ['shift_start', '10:00'],
      ['branch_name_ar', 'فرع السالمية'],
      ['branch_name_en', 'Salmiya'],
    ]);
  }
  const text = JSON.stringify(rows);
  expect(text).not.toContain(ENDPOINT);
  expect(text).not.toContain(P256DH);
  expect(text).not.toContain(AUTH);
  expect(text).not.toContain(tokenAr);
  expect(text).not.toContain(tokenEn);
  expect(text).not.toContain(REVOKED);
  expect(text).not.toContain(FOREIGN);
});

it('uses only the live subscriptions of the requested user', async () => {
  const event = await h.request([pushRecipient(OTHER_USER)]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  expect(await h.attempts(event.id)).toHaveLength(1);
  expect((await h.attempts(event.id))[0]?.['subscription_id']).toBe(OTHER);
  const withoutSubscription = await h.request([
    pushRecipient('01920000-0000-7000-8000-0000000000f9'),
  ]);
  expect(await h.deliver(withoutSubscription)).toEqual({ delivered: true });
  expect(await h.attempts(withoutSubscription.id)).toHaveLength(0);
  expect(await h.authorized(withoutSubscription.id)).toHaveLength(0);
});

it('writes no second attempt and no second event when the same event is delivered again', async () => {
  const event = await h.request([pushRecipient()]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  expect(await h.deliver(event)).toEqual({ delivered: true });
  await h.db.withTenant(event.companyId, (tx) => h.consumer.handle(tx, event));
  expect(await h.attempts(event.id)).toHaveLength(2);
  expect(await h.authorized(event.id)).toHaveLength(2);
});

it('records an expired attempt with no authorization event when the deadline has passed', async () => {
  const event = await h.request([pushRecipient(PUSH_USER, '2026-10-01T09:00:00Z')]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  const rows = await h.attempts(event.id);
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row['status'] === 'EXPIRED')).toBe(true);
  expect(rows.every((row) => row['failure_code'] === 'DEADLINE_EXPIRED')).toBe(true);
  expect(rows.every((row) => row['outcome_known'] === true)).toBe(true);
  expect(rows.every((row) => row['finished_at'] !== null)).toBe(true);
  expect(await h.authorized(event.id)).toHaveLength(0);
});

it('writes nothing while the sender is not configured and still refuses an invalid template', async () => {
  const event = await h.request([pushRecipient()]);
  await h.db.withTenant(event.companyId, (tx) => h.disabled.handle(tx, event));
  expect(await h.attempts(event.id)).toHaveLength(0);
  const invalid = await h.request([{ ...pushRecipient(), template_key: 'unknown_notice' }]);
  await expect(
    h.db.withTenant(invalid.companyId, (tx) => h.disabled.handle(tx, invalid)),
  ).rejects.toThrow('NOTIFICATION_REQUEST_INVALID');
  const unsafe = await h.request([
    {
      ...pushRecipient(),
      safe_parameters: [{ name: 'shift_start', type: 'text', value: 'https://example.test' }],
    },
  ]);
  await expect(
    h.db.withTenant(unsafe.companyId, (tx) => h.disabled.handle(tx, unsafe)),
  ).rejects.toThrow('NOTIFICATION_REQUEST_INVALID');
});

it('accepts a request that holds only push recipients, one per user', async () => {
  const event = await h.request([pushRecipient(PUSH_USER), pushRecipient(OTHER_USER)]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  expect(await h.attempts(event.id)).toHaveLength(3);
  expect(await h.authorized(event.id)).toHaveLength(3);
});

it('stores the in-app rows and the push attempts independently in one request', async () => {
  const event = await h.request([
    {
      channel: 'IN_APP',
      user_id: PUSH_USER,
      locale: 'ar',
      template_key: 'generic_notice',
      template_revision: 1,
      safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
    },
    pushRecipient(),
  ]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  expect(await h.inbox(event.id)).toHaveLength(1);
  expect(await h.attempts(event.id)).toHaveLength(2);
  expect(await h.authorized(event.id)).toHaveLength(2);
  expect(await h.phoneAttempts(event.id)).toHaveLength(0);
});

it('accepts a request whose branch name is rejected in both languages', async () => {
  const event = await h.request([
    {
      ...pushRecipient(),
      safe_parameters: PUSH_PARAMETERS.map((parameter) =>
        parameter.name === 'branch_name_ar'
          ? { ...parameter, value: 'https://example.test' }
          : parameter.name === 'branch_name_en'
            ? { ...parameter, value: '' }
            : parameter,
      ),
    },
  ]);
  expect(await h.deliver(event)).toEqual({ delivered: true });
  expect(await h.attempts(event.id)).toHaveLength(2);
  expect(await h.authorized(event.id)).toHaveLength(2);
});
