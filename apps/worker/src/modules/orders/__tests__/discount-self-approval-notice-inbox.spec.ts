import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import { createLogger } from '@pospay/observability';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { t } from '@pospay/i18n';
import { validInAppTemplate, type SafeParameter } from '@pospay/notifications';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { beforeAll, afterAll, expect, it } from 'vitest';
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

// صندوق الإدارة يفلتر company_id و recipient_user_id؛ الاستعلام نفسه هنا لأن العامل لا يستورد apps/api.
it('the stored parameters render in ar and en, and each in-app row is visible only to its recipient', async () => {
  const otherOwner = await f.user();
  await f.member(otherOwner, 'owner');
  const stranger = await f.user();
  const prepared = await f.decision({ proposals: 1, announcedBps: 2050, storedBps: 2050 });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  const sourceId = await storeInbox(prepared.companyId, ledger?.['id'] as string);
  expect(
    await f.owner`SELECT recipient_user_id,template_key,locale FROM in_app_notifications
      WHERE company_id=${f.tenant.company} AND source_event_id=${sourceId} ORDER BY recipient_user_id`,
  ).toEqual(
    [USER, otherOwner].sort().map((userId) => ({
      recipient_user_id: userId,
      template_key: 'discount_self_approved',
      locale: 'ar',
    })),
  );
  const [row] = await f.owner`SELECT safe_parameters FROM in_app_notifications
    WHERE company_id=${f.tenant.company} AND recipient_user_id=${USER} AND source_event_id=${sourceId}`;
  const parameters = row?.['safe_parameters'] as SafeParameter[];
  expect(validInAppTemplate('discount_self_approved', 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate('discount_self_approved', 1, 'en', parameters)).toBe(true);
  expect(parameters.map((parameter) => parameter.name)).toEqual([
    'branch_name_ar',
    'branch_name_en',
    'approver_name_ar',
    'approver_name_en',
    'service_name_ar',
    'service_name_en',
    'max_percent',
  ]);
  expect(parameters.find((parameter) => parameter.name === 'max_percent')?.['value']).toBe('20.5');
  // لقطة الموافِق: الاسم العربي من الحدث عربي والإنجليزي إنجليزي، ولا اسم عميل ولا هاتف في أي لغة.
  expect(fill('en', parameters)).toContain('Synthetic decider');
  expect(fill('ar', parameters)).toContain('موافق تجريبي');
  for (const locale of ['ar', 'en'] as const) {
    const text = fill(locale, parameters);
    expect(text).toContain('Synthetic service');
    expect(text).toContain('20.5');
    expect(text).not.toContain('Synthetic customer');
    expect(text).not.toContain('+999999998123');
  }
  expect(fill('ar', parameters)).toContain('فرع');
  expect(await visible(f.tenant.company, USER, sourceId)).toHaveLength(1);
  expect(await visible(f.tenant.company, otherOwner, sourceId)).toHaveLength(1);
  expect(await visible(f.tenant.company, stranger, sourceId)).toHaveLength(0);
  expect(await visible(TENANT.B.company, USER, sourceId)).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceId}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationSendAuthorized' AND payload->>'source_event_id'=${sourceId}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationDelivered' AND payload->>'source_event_id'=${sourceId}`,
  ).toHaveLength(2);
});

function fill(locale: 'ar' | 'en', parameters: readonly SafeParameter[]): string {
  return parameters.reduce(
    (text, parameter) => {
      const value = parameter.value;
      return typeof value === 'string' ? text.replaceAll(`{{${parameter.name}}}`, value) : text;
    },
    t(locale, 'inApp.discount_self_approved'),
  );
}
function visible(companyId: string, userId: string, sourceId: string) {
  return f.owner`SELECT id FROM in_app_notifications
    WHERE company_id=${companyId} AND recipient_user_id=${userId} AND source_event_id=${sourceId}`;
}
async function storeInbox(companyId: string, aggregateId: string): Promise<string> {
  const [request] = await f.decisions(companyId, aggregateId);
  if (!request) throw new Error('decision notice required');
  const input = {
    companyId,
    id: request['id'] as string,
    aggregateType: 'discount_self_approval',
    aggregateId,
    eventType: 'DiscountSelfApprovalNoticeRequested',
    payload: request['payload'],
    attempt: 1,
  };
  const inApp = createInAppTestModule(f.db, f.ids, { now: () => f.at });
  const notifications = createDeliverer(f.db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  await notifications(input);
  return input.id;
}
