import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import { createLogger } from '@pospay/observability';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { t } from '@pospay/i18n';
import { validInAppTemplate, type SafeParameter } from '@pospay/notifications';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { priceEditFixture, type PriceEditFixture } from './price-edit-notice.fixture.ts';

let f: PriceEditFixture;
beforeAll(async () => {
  f = await priceEditFixture();
});
afterAll(async () => {
  await f?.close();
});

// صندوق الإدارة يفلتر company_id و recipient_user_id؛ الاستعلام نفسه هنا لأن العامل لا يستورد apps/api.
it('test 9: the stored parameters render in ar and en, and each in-app row is visible only to its recipient', async () => {
  const manager = await f.user();
  await f.member(manager, 'branch_manager', 'BRANCH', f.tenant.branch);
  const stranger = await f.user();
  const prepared = await f.edit();
  await f.deliver(prepared.event);
  const sourceId = await storeInbox(prepared.sessionId);
  const [row] = await f.owner`SELECT safe_parameters FROM in_app_notifications
    WHERE company_id=${f.tenant.company} AND recipient_user_id=${USER} AND source_event_id=${sourceId}`;
  const parameters = row?.['safe_parameters'] as SafeParameter[];
  expect(validInAppTemplate('service_line_price_edited', 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate('service_line_price_edited', 1, 'en', parameters)).toBe(true);
  for (const locale of ['ar', 'en'] as const) {
    const text = fill(locale, parameters);
    expect(text).toContain('2.500');
    expect(text).toContain('1250.000');
  }
  expect(fill('ar', parameters)).toContain('Synthetic editor');
  expect(fill('en', parameters)).toContain('Synthetic service');
  expect(fill('en', parameters)).toContain('Branch A');
  expect(await visible(f.tenant.company, USER, sourceId)).toHaveLength(1);
  expect(await visible(f.tenant.company, manager, sourceId)).toHaveLength(1);
  expect(await visible(f.tenant.company, stranger, sourceId)).toHaveLength(0);
  expect(await visible(TENANT.B.company, USER, sourceId)).toHaveLength(0);
  expect(await f.owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceId}`).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationSendAuthorized' AND payload->>'source_event_id'=${sourceId}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationDelivered' AND payload->>'source_event_id'=${sourceId}`,
  ).toHaveLength(2);
});

function fill(locale: 'ar' | 'en', parameters: readonly SafeParameter[]): string {
  return parameters.reduce((text, parameter) => {
    const value = parameter.value;
    return typeof value === 'string' ? text.replaceAll(`{{${parameter.name}}}`, value) : text;
  }, t(locale, 'inApp.service_line_price_edited'));
}
function visible(companyId: string, userId: string, sourceId: string) {
  return f.owner`SELECT id FROM in_app_notifications
    WHERE company_id=${companyId} AND recipient_user_id=${userId} AND source_event_id=${sourceId}`;
}
async function storeInbox(sessionId: string): Promise<string> {
  const [request] = await f.requests(sessionId);
  if (!request) throw new Error('request required');
  const input = {
    companyId: f.tenant.company,
    id: request['id'] as string,
    aggregateType: 'service_session',
    aggregateId: sessionId,
    eventType: 'ServiceLineEditNoticeRequested',
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
