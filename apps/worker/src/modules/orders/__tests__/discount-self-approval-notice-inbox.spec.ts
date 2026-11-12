import type { ClaimedEvent } from '@pospay/db';
import { t } from '@pospay/i18n';
import { validInAppTemplate, type SafeParameter } from '@pospay/notifications';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { PreparedSelfApproval } from './discount-self-approval-notice-data.ts';
import {
  discountSelfApprovalFixture,
  type DiscountSelfApprovalFixture,
} from './discount-self-approval-notice.fixture.ts';

let f: DiscountSelfApprovalFixture;
beforeAll(async () => {
  f = await discountSelfApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('the in-app consumer stores one safe owner bell and excludes every other audience', async () => {
  const { scope, ownerId, strangerId, sourceId } = await setupInbox();
  const [row] = await f.owner`SELECT * FROM in_app_notifications
    WHERE company_id=${scope.company} AND recipient_user_id=${ownerId} AND source_event_id=${sourceId}`;
  expect(row).toMatchObject({
    source_event_id: sourceId,
    template_key: 'discount_self_approved',
    template_revision: 1,
    locale: 'ar',
  });
  const parameters = row?.['safe_parameters'] as SafeParameter[];
  expect(parameters).toHaveLength(7);
  expect(validInAppTemplate('discount_self_approved', 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate('discount_self_approved', 1, 'en', parameters)).toBe(true);
  expectRenderedCopy(parameters);
  expect(await visible(scope.company, ownerId, sourceId)).toHaveLength(1);
  expect(await visible(scope.company, strangerId, sourceId)).toHaveLength(0);
  expect(await visible(TENANT.B.company, ownerId, sourceId)).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceId}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationDelivered'
      AND payload->>'source_event_id'=${sourceId}`,
  ).toHaveLength(1);
}, 60_000);

async function setupInbox() {
  const scope = await f.otherCompany();
  const ownerId = await f.user();
  const membershipId = await f.member(
    ownerId,
    'owner',
    'COMPANY',
    scope.company,
    undefined,
    null,
    scope.company,
  );
  const strangerId = await f.user();
  const prepared = await f.selfApproval({
    scope,
    decidedBy: { userId: ownerId, membershipId },
    proposals: [{ bps: 1000 }, { bps: 2500 }],
  });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  return { scope, ownerId, strangerId, sourceId: await storeInbox(prepared) };
}

async function storeInbox(prepared: PreparedSelfApproval): Promise<string> {
  const [bell] = await f.bells(prepared.event.id);
  if (!bell) throw new Error('self-approval bell required');
  const input: ClaimedEvent = {
    companyId: prepared.companyId,
    id: bell['id'] as string,
    aggregateType: 'discount_self_approval_notice',
    aggregateId: bell['aggregate_id'] as string,
    eventType: 'DiscountSelfApprovalNoticeRequested',
    payload: bell['payload'],
    attempt: 1,
  };
  const inApp = createInAppTestModule(f.db, f.ids, { now: () => f.at });
  const deliver = createDeliverer(f.db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  expect(await deliver(input)).toEqual({ delivered: true });
  return input.id;
}

function expectRenderedCopy(parameters: readonly SafeParameter[]): void {
  for (const locale of ['ar', 'en'] as const) {
    const text = fill(locale, parameters);
    expect(text).toContain('Other branch');
    expect(text).toContain('Synthetic service');
    expect(text).toContain('25');
    expect(text).not.toContain('Synthetic customer');
    expect(text).not.toMatch(/\+9\d/);
    expect(text).not.toContain('{{');
  }
  expect(fill('ar', parameters)).toContain('مالك تجريبي');
  expect(fill('en', parameters)).toContain('Synthetic owner');
}

function fill(locale: 'ar' | 'en', parameters: readonly SafeParameter[]): string {
  return parameters.reduce(
    (text, parameter) => {
      const value = parameter.value;
      return typeof value === 'string' ? text.replaceAll(`{{${parameter.name}}}`, value) : text;
    },
    t(locale, 'inApp.discount_self_approved'),
  );
}

// صندوق الإدارة يفلتر company_id و recipient_user_id؛ الاستعلام نفسه هنا لأن العامل لا يستورد apps/api.
function visible(companyId: string, userId: string, sourceId: string) {
  return f.owner`SELECT id FROM in_app_notifications
    WHERE company_id=${companyId} AND recipient_user_id=${userId} AND source_event_id=${sourceId}`;
}
