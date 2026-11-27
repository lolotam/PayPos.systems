import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendOutboxEvent, type ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { readEmailConfiguration } from '@pospay/notifications';
import { seedInboxUsers } from '../../../../../../packages/db/test/in-app-fixtures.ts';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createInAppNotificationModule } from '../notifications.module.ts';
import { EMAIL_ENV, PHONE } from './harness.ts';
import { platformHarness } from './platform-harness.ts';

// AL-Q6 (صف 62b-1): حدث واحد فيه جرس وإيميل وواتساب لتنبيه فريق لازم يفضل جرسه سليم في كل إعداد،
// وواتساب تنبيه الفريق بيتسجّل محاولة FAILED / CONFIG_INVALID ظاهرة بدل ما يرمي ويوقف الحدث (ADR-0018 §11).
const EMAIL = 'synthetic.manager@example.invalid';
const PHONE_KEY = { hashKey: 'phone-key-not-a-secret'.repeat(3), hashKeyId: 'test-v1' };

let h: Awaited<ReturnType<typeof platformHarness>>;
beforeAll(async () => {
  h = await platformHarness();
  await seedInboxUsers(h.owner);
});
afterAll(async () => {
  await h?.close();
});

/** حدث فيه المستلمين الثلاثة بمفتاح قالب تنبيه الفريق التشغيلي؛ الجرس بقالب عام صالح قائم. */
async function threeChannelEvent(templateKey = 'late_service_session'): Promise<ClaimedEvent> {
  const ids = systemUuidV7();
  const id = ids.newId();
  const operational = { locale: 'ar', template_key: templateKey, template_revision: 1, safe_parameters: [] };
  const payload = {
    notification_recipients: [
      {
        channel: 'IN_APP',
        user_id: USER,
        locale: 'ar',
        template_key: 'generic_notice',
        template_revision: 1,
        safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
      },
      { channel: 'email', email: EMAIL, ...operational },
      { channel: 'whatsapp', phone: PHONE, ...operational },
    ],
  };
  await h.db.withTenant(TENANT.A.company, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType: 'test',
      aggregateId: id,
      eventType: 'LateServiceSessionNoticeRequested',
      payload,
    }),
  );
  return {
    id,
    companyId: TENANT.A.company,
    aggregateType: 'test',
    aggregateId: id,
    eventType: 'LateServiceSessionNoticeRequested',
    payload,
    attempt: 1,
  };
}

const inAppRows = (id: string) =>
  h.owner`SELECT id FROM in_app_notifications WHERE source_event_id=${id}`;
const attempts = (id: string) =>
  h.owner`SELECT channel, status, failure_code, recipient_phone, recipient_email, phone_last3, template_key
    FROM notification_attempts WHERE source_event_id=${id} ORDER BY channel`;
const failedEvents = (id: string) =>
  h.owner`SELECT payload FROM outbox WHERE company_id=${TENANT.A.company} AND event_type='NotificationFailed'
    AND payload->>'source_event_id'=${id}`;

describe('production in-app module', () => {
  it('records team-alert email and WhatsApp as FAILED / CONFIG_INVALID even without hash keys, and keeps the bell', async () => {
    const module = createInAppNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
    });
    const event = await threeChannelEvent();
    await h.db.withTenant(event.companyId, (tx) => module.consumer.handle(tx, event));
    expect(await inAppRows(event.id)).toHaveLength(1);
    const rows = await attempts(event.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row['channel'] === 'email')).toMatchObject({
      status: 'FAILED',
      failure_code: 'CONFIG_INVALID',
      recipient_email: null,
      recipient_phone: null,
      phone_last3: null,
      template_key: 'late_service_session',
    });
    expect(rows.find((row) => row['channel'] === 'whatsapp')).toMatchObject({
      status: 'FAILED',
      failure_code: 'CONFIG_INVALID',
      recipient_phone: null,
      recipient_email: null,
      phone_last3: '001',
      template_key: 'late_service_session',
    });
    const results = await failedEvents(event.id);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(EMAIL);
  });
});

describe('production in-app module non-team-alert guard', () => {
  it('refuses non-team-alert email atomically when email hash key is absent', async () => {
    const module = createInAppNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
    });
    const event = await threeChannelEvent('rating_request');
    await expect(
      h.db.withTenant(event.companyId, (tx) => module.consumer.handle(tx, event)),
    ).rejects.toThrow('EMAIL_DISABLED_HASH_UNAVAILABLE');
    expect(await inAppRows(event.id)).toHaveLength(0);
    expect(await attempts(event.id)).toHaveLength(0);
  });

  it('records the WhatsApp team alert as FAILED / CONFIG_INVALID with no stored number, and keeps the bell', async () => {
    const module = createInAppNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
      phoneConfiguration: PHONE_KEY,
      emailConfiguration: readEmailConfiguration({ ...EMAIL_ENV, RESEND_API_KEY: '' }),
    });
    const event = await threeChannelEvent();
    await h.db.withTenant(event.companyId, (tx) => module.consumer.handle(tx, event));
    expect(await inAppRows(event.id)).toHaveLength(1);
    const rows = await attempts(event.id);
    expect(rows).toHaveLength(2);
    const whatsapp = rows.find((row) => row['channel'] === 'whatsapp');
    expect(whatsapp).toEqual({
      channel: 'whatsapp',
      status: 'FAILED',
      failure_code: 'CONFIG_INVALID',
      recipient_phone: null,
      recipient_email: null,
      phone_last3: '001',
      template_key: 'late_service_session',
    });
    // البريد المقفول بإعداد ناقص بيتسجّل هو كمان بسبب CONFIG_INVALID ومن غير عنوان محفوظ.
    expect(rows.find((row) => row['channel'] === 'email')).toMatchObject({
      status: 'FAILED',
      failure_code: 'CONFIG_INVALID',
      recipient_email: null,
    });
    const results = await failedEvents(event.id);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(EMAIL);
  });

});

describe('production in-app module with a configured email channel', () => {
  it('authorizes the email of a fully configured channel as PENDING and still fails WhatsApp closed', async () => {
    const module = createInAppNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
      phoneConfiguration: PHONE_KEY,
      emailConfiguration: readEmailConfiguration(EMAIL_ENV),
    });
    const event = await threeChannelEvent();
    await h.db.withTenant(event.companyId, (tx) => module.consumer.handle(tx, event));
    const rows = await attempts(event.id);
    expect(rows.find((row) => row['channel'] === 'email')).toMatchObject({ status: 'PENDING' });
    expect(rows.find((row) => row['channel'] === 'whatsapp')).toMatchObject({
      status: 'FAILED',
      failure_code: 'CONFIG_INVALID',
      recipient_phone: null,
    });
  });

  it('still refuses any other WhatsApp template in production, atomically', async () => {
    const module = createInAppNotificationModule({
      database: h.db,
      ids: systemUuidV7(),
      clock: h.clock,
      phoneConfiguration: PHONE_KEY,
      emailConfiguration: readEmailConfiguration(EMAIL_ENV),
    });
    const event = await threeChannelEvent('rating_request');
    await expect(
      h.db.withTenant(event.companyId, (tx) => module.consumer.handle(tx, event)),
    ).rejects.toThrow('NOTIFICATIONS_LIVE_REQUIRES_PR6');
    expect(await inAppRows(event.id)).toHaveLength(0);
    expect(await attempts(event.id)).toHaveLength(0);
  });
});

describe('full notification module (non-production)', () => {
  it('records the team-alert WhatsApp recipient as FAILED / CONFIG_INVALID beside the bell and the email', async () => {
    const event = await threeChannelEvent('low_rating');
    await h.db.withTenant(event.companyId, (tx) => h.module.consumer.handle(tx, event));
    expect(await inAppRows(event.id)).toHaveLength(1);
    const rows = await attempts(event.id);
    expect(rows.find((row) => row['channel'] === 'whatsapp')).toMatchObject({
      status: 'FAILED',
      failure_code: 'CONFIG_INVALID',
      recipient_phone: null,
      phone_last3: '001',
      template_key: 'low_rating',
    });
    expect(rows.find((row) => row['channel'] === 'email')).toMatchObject({
      status: 'PENDING',
      template_key: 'low_rating',
    });
  });
});
