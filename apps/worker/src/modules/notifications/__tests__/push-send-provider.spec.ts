import type { FakePushOutcome } from '@pospay/notifications';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

const ROWS: [FakePushOutcome, string, number | null, boolean, boolean][] = [
  ['400', 'PROVIDER_4XX', 400, false, true],
  ['401', 'PROVIDER_4XX', 401, true, true],
  ['403', 'PROVIDER_4XX', 403, true, true],
  ['413', 'PROVIDER_4XX', 413, false, true],
  ['429', 'PROVIDER_429', 429, false, true],
  ['5xx', 'PROVIDER_5XX', 503, false, false],
  ['timeout', 'NETWORK_UNKNOWN', null, false, false],
];

it.each(ROWS)(
  'maps the answer %s to a known failure and keeps the subscription live',
  async (outcome, failureCode, httpStatus, vapidRejected, outcomeKnown) => {
    const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
    h.channel.outcome = outcome;
    const result = await h.send.execute(TENANT.A.company, attemptId);
    expect(result).toMatchObject({ status: 'FAILED', failureCode, httpStatus, vapidRejected });
    const [row] = await h.attempt(attemptId);
    expect(row).toMatchObject({ status: 'FAILED', failure_code: failureCode });
    expect(row?.['http_status']).toBe(httpStatus);
    expect(row?.['outcome_known']).toBe(outcomeKnown);
    const [subscription] = await h.subscription(subscriptionId);
    expect(subscription?.['revoked_at']).toBeNull();
    const events = await h.events(attemptId);
    expect(events).toHaveLength(1);
    expect(events[0]?.['event_type']).toBe('NotificationFailed');
  },
);

it('refuses the attempt when the admission budget is spent', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  h.allowAdmission(false);
  const before = h.channel.calls;
  const result = await h.send.execute(TENANT.A.company, attemptId);
  h.allowAdmission(true);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'ADMISSION_REFUSED' });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'FAILED', failure_code: 'ADMISSION_REFUSED' });
  expect(row?.['execution_id']).toBeNull();
});

it('refuses a template that no longer renders', async () => {
  const { subscriptionId } = await h.authorizeAttempt('ar');
  const attemptId = await h.pendingAttempt({
    subscriptionId,
    templateKey: 'unknown_notice',
  });
  const before = h.channel.calls;
  const result = await h.send.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'PARAMETERS_INVALID' });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'FAILED', failure_code: 'PARAMETERS_INVALID' });
});

it('refuses a payload that is over the size cap', async () => {
  const { subscriptionId } = await h.authorizeAttempt('ar');
  const attemptId = await h.pendingAttempt({
    subscriptionId,
    parameters: [
      { name: 'shift_start', type: 'text', value: '10:00' },
      { name: 'branch_name_ar', type: 'text', value: 'فرع'.repeat(300) },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    ],
  });
  const before = h.channel.calls;
  const result = await h.send.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'PARAMETERS_INVALID' });
  expect(h.channel.calls).toBe(before);
});
