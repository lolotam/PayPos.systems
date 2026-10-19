import { t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { validInAppTemplate, type SafeParameter } from '@pospay/notifications';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import {
  LINE_NET,
  PERFORMER_NAME,
  PERFORMERS_CHANGER,
  PERFORMERS_REASON,
} from './performers-change-data.ts';
import {
  performersChangeFixture,
  type PerformersChangeFixture,
} from './performers-change-notice.fixture.ts';

let f: PerformersChangeFixture;
beforeAll(async () => {
  f = await performersChangeFixture();
});
afterAll(async () => {
  await f?.close();
});

it('the notice event becomes an in-app row for service_line_performers_changed with no reason, performer or changer', async () => {
  const manager = await f.user();
  await f.member(manager, 'branch_manager', 'BRANCH', f.tenant.branch);
  const stranger = await f.user();
  const prepared = await f.change();
  await f.deliver(prepared.event);
  const sourceId = await storeInbox(prepared.lineId, prepared.sessionId);
  const [row] = await f.owner`SELECT safe_parameters FROM in_app_notifications
    WHERE company_id=${f.tenant.company} AND recipient_user_id=${USER} AND source_event_id=${sourceId}`;
  const parameters = row?.['safe_parameters'] as SafeParameter[];
  expect(validInAppTemplate('service_line_performers_changed', 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate('service_line_performers_changed', 1, 'en', parameters)).toBe(true);
  expect(parameters.map((item) => item.name)).toEqual([
    'service_name_ar',
    'service_name_en',
    'branch_name_ar',
    'branch_name_en',
    'business_date',
    'line_net',
  ]);
  for (const locale of ['ar', 'en'] as const) expect(fill(locale, parameters)).toContain(LINE_NET);
  expect(fill('en', parameters)).toContain('Synthetic');
  expect(fill('en', parameters)).toContain('Branch A');
  const leaked = `${JSON.stringify(parameters)}${JSON.stringify(await f.requests(prepared.lineId))}`;
  expect(leaked).not.toContain(PERFORMERS_REASON);
  expect(leaked).not.toContain(PERFORMERS_CHANGER);
  expect(leaked).not.toContain(PERFORMER_NAME);
  expect(leaked).not.toContain('+999999998123');
  expect(leaked).not.toContain('Synthetic customer');
  expect(await visible(f.tenant.company, USER, sourceId)).toHaveLength(1);
  expect(await visible(f.tenant.company, manager, sourceId)).toHaveLength(1);
  expect(await visible(f.tenant.company, stranger, sourceId)).toHaveLength(0);
  expect(await visible(TENANT.B.company, USER, sourceId)).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceId}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationSendAuthorized' AND payload->>'source_event_id'=${sourceId}`,
  ).toHaveLength(0);
});

function fill(locale: 'ar' | 'en', parameters: readonly SafeParameter[]): string {
  return parameters.reduce(
    (text, parameter) => {
      const value = parameter.value;
      return typeof value === 'string' ? text.replaceAll(`{{${parameter.name}}}`, value) : text;
    },
    t(locale, 'inApp.service_line_performers_changed'),
  );
}
function visible(companyId: string, userId: string, sourceId: string) {
  return f.owner`SELECT id FROM in_app_notifications
    WHERE company_id=${companyId} AND recipient_user_id=${userId} AND source_event_id=${sourceId}`;
}
async function storeInbox(lineId: string, sessionId: string): Promise<string> {
  const requests = await f.requests(lineId);
  const request = requests[0];
  if (!request || requests.length !== 1) throw new Error('request required');
  const input = {
    companyId: f.tenant.company,
    id: request['id'] as string,
    aggregateType: 'service_session',
    aggregateId: sessionId,
    eventType: 'ServiceLinePerformersNoticeRequested',
    payload: request['payload'],
    attempt: 1,
  };
  const inApp = createInAppTestModule(f.db, f.ids, { now: () => f.at });
  const notifications = createDeliverer(f.db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  expect(await notifications(input)).toEqual({ delivered: true });
  return input.id;
}
