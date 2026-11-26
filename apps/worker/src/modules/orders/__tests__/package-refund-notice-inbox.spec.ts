import type { ClaimedEvent } from '@pospay/db';
import { t } from '@pospay/i18n';
import { validInAppTemplate, type SafeParameter } from '@pospay/notifications';
import { createLogger } from '@pospay/observability';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import {
  REFUND_AMOUNT,
  REFUND_BUSINESS_DATE,
  REFUND_REASON,
  REFUNDER_USER,
  packageRefundNoticeFixture,
  type PackageRefundNoticeFixture,
} from './package-refund-notice.fixture.ts';

let f: PackageRefundNoticeFixture;

beforeAll(async () => {
  f = await packageRefundNoticeFixture();
});

afterAll(async () => {
  await f?.close();
});

function fill(locale: 'ar' | 'en', parameters: readonly SafeParameter[]): string {
  return parameters.reduce(
    (text, parameter) => {
      const value = parameter.value;
      return typeof value === 'string' ? text.replaceAll(`{{${parameter.name}}}`, value) : text;
    },
    t(locale, 'inApp.package_refund_recorded'),
  );
}

function visible(companyId: string, userId: string, sourceId: string) {
  return f.owner`SELECT id FROM in_app_notifications
    WHERE company_id = ${companyId} AND recipient_user_id = ${userId} AND source_event_id = ${sourceId}`;
}

it('stores safe IN_APP bells for both scoped managers without leaking reason or PII', async () => {
  const seeded = await f.refund();
  expect(await f.deliver(seeded.event)).toEqual({ delivered: true });
  const [bell] = await f.requests(seeded.entitlement);
  if (!bell) throw new Error('expected PackageRefundNoticeRequested outbox row');

  const input: ClaimedEvent = {
    companyId: f.companyId,
    id: bell['id'] as string,
    aggregateType: 'package_entitlement',
    aggregateId: seeded.entitlement,
    eventType: 'PackageRefundNoticeRequested',
    payload: bell['payload'],
    attempt: 1,
  };
  const inApp = createInAppTestModule(f.db, f.ids, { now: () => f.at });
  const deliver = createDeliverer(f.db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  expect(await deliver(input)).toEqual({ delivered: true });

  const rows = await f.owner`SELECT * FROM in_app_notifications
    WHERE company_id = ${f.companyId} AND source_event_id = ${input.id}`;
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row['recipient_user_id']).sort()).toEqual([USER, REFUNDER_USER]);
  expect(rows[0]).toMatchObject({
    template_key: 'package_refund_recorded',
    template_revision: 1,
    locale: 'ar',
  });

  const parameters = rows[0]?.['safe_parameters'] as SafeParameter[];
  expect(validInAppTemplate('package_refund_recorded', 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate('package_refund_recorded', 1, 'en', parameters)).toBe(true);
  for (const locale of ['ar', 'en'] as const) {
    const rendered = fill(locale, parameters);
    expect(rendered).toContain('Synthetic package');
    expect(rendered).toContain('Branch A');
    expect(rendered).toContain(REFUND_AMOUNT);
    expect(rendered).toContain(REFUND_BUSINESS_DATE);
    expect(rendered).not.toContain(REFUND_REASON);
    expect(rendered).not.toMatch(/\+9\d/);
    expect(rendered).not.toContain('{{');
  }

  expect(await visible(f.companyId, USER, input.id)).toHaveLength(1);
  expect(await visible(f.companyId, REFUNDER_USER, input.id)).toHaveLength(1);
  expect(await visible(TENANT.B.company, USER, input.id)).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM notification_attempts WHERE source_event_id = ${input.id}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type = 'NotificationDelivered'
      AND payload->>'source_event_id' = ${input.id}`,
  ).toHaveLength(2);
}, 60_000);
