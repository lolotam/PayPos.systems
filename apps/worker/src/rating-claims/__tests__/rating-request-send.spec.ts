// 59b-3: إرسال طلب التقييم: الرابط يتشتق في الذاكرة وقت الإرسال، وقبول المزود هو اللي بيحرّك الطلب إلى SENT.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';

import type { ClaimedEvent } from '@pospay/db';
import { createTemplateRegistry, type Channel, type ChannelResult } from '@pospay/notifications';
import type { Logger } from '@pospay/observability';

import { TENANT } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { createRatingSentConsumer } from '../../modules/customers/index.ts';
import type { RatingTokenDeriver } from '../../modules/customers/ports/rating-token.port.ts';
import { createNotificationModule } from '../../modules/notifications/index.ts';
import { createDeliverer } from '../../outbox/deliver.ts';
import { createRatingTokenSender } from '../../rating-token-capability.ts';
import { recordingChannel } from './rating-claims-notification.fixture.ts';
import {
  everyDay,
  ratingClaimsFixture,
  type RatingClaimsFixture,
} from './rating-claims.fixture.ts';

const K1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const K2 = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';
const ENV_V1 = { RATING_TOKEN_DERIVATION_KEY: K1, RATING_TOKEN_DERIVATION_KEY_VERSION: '1' };
const ENV_V2 = {
  RATING_TOKEN_DERIVATION_KEY: K2,
  RATING_TOKEN_DERIVATION_KEY_VERSION: '2',
  RATING_TOKEN_DERIVATION_RETIRED_KEYS: JSON.stringify({ '1': K1 }),
};
const ORIGIN = 'https://rating.test';
const TEST_CONFIGURATION = {
  mode: 'fake' as const,
  hashKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  hashKeyId: 'rating-send-test-v1',
};
const KUWAIT = 'Asia/Kuwait';
const VISIT = new Date('2026-06-01T12:10:00.000Z');
const CLAIM_AT = new Date('2026-06-01T13:30:00.000Z');

let f: RatingClaimsFixture;
beforeEach(async () => {
  f = await ratingClaimsFixture();
});
afterEach(async () => {
  await f?.close();
});

/** سجل يمسك كل سطر، عشان الاختبار يتأكد إن الرابط ما اتسجلش في أي مكان. */
function recordingLogger(): { logger: Logger; lines: unknown[] } {
  const lines: unknown[] = [];
  const logger: Logger = new Proxy({} as Logger, {
    get: (_target, property) =>
      property === 'child'
        ? () => logger
        : (...args: unknown[]) => {
            lines.push([String(property), args]);
          },
  });
  return { logger, lines };
}

/** اشتقاق البصمة للمطالبة: نفس sha256 على نص الرابط اللي بتعمله حزمة auth، بإصدار مفتاح اختياري. */
function claimDeriver(env: NodeJS.ProcessEnv, storedVersion = 1): RatingTokenDeriver {
  const sender = createRatingTokenSender(env);
  if (sender === null) throw new Error('TEST_RING_NOT_READY');
  return {
    claim: (identity) => {
      const token = sender.token(identity, 1);
      if (token === null) throw new Error('TEST_TOKEN_MISSING');
      return {
        tokenHash: createHash('sha256').update(token, 'utf8').digest(),
        keyVersion: storedVersion,
      };
    },
  };
}

function sendModule(channel: Channel, env: NodeJS.ProcessEnv) {
  return createNotificationModule({
    database: f.db,
    ids: f.ids,
    clock: f.clock,
    configuration: TEST_CONFIGURATION,
    production: false,
    channel,
    registry: createTemplateRegistry(undefined, {
      rating_request: { ar: 'rating_request_ar', en: 'rating_request_en' },
    }),
    suppression: () => ({ isSuppressed: async () => false }),
    ratingToken: createRatingTokenSender(env),
    ratingPageOrigin: ORIGIN,
  });
}

/** زيارة ثم مطالبة حقيقية: بيطلع حدث الجاهزية في الـ outbox والطلب في SENDING. */
async function claimedReady(deriver: RatingTokenDeriver, customerName?: string) {
  f.token.deriver = deriver;
  const branchId = await f.branch({
    timezone: KUWAIT,
    openingHours: everyDay([{ opens: '10:00', closes: '22:00' }]),
  });
  const customerId = await f.customer();
  if (customerName !== undefined)
    await f.owner`UPDATE customers SET name = ${customerName}
      WHERE company_id = ${f.company} AND id = ${customerId}`;
  const { sessionId } = await f.session({ customerId, branchId, occurredAt: VISIT });
  await f.schedule(sessionId);
  f.clock.at = CLAIM_AT;
  const requestId = (await f.requestIds(customerId))[0] ?? '';
  await f.claimOne(requestId);
  const eventId = String((await f.readyEvents())[0]?.['id']);
  return { requestId, eventId };
}

async function eventById(id: string): Promise<ClaimedEvent> {
  const row = (
    await f.owner`SELECT company_id, id, aggregate_type, aggregate_id, event_type, payload, attempts
    FROM outbox WHERE id = ${id}`
  )[0];
  if (row === undefined) throw new Error('TEST_EVENT_MISSING');
  return {
    companyId: String(row['company_id']),
    id: String(row['id']),
    aggregateType: String(row['aggregate_type']),
    aggregateId: String(row['aggregate_id']),
    eventType: String(row['event_type']),
    payload: row['payload'],
    attempt: Number(row['attempts']),
  };
}

function deliverer(module: ReturnType<typeof sendModule>, logger: Logger) {
  return createDeliverer(f.db, [module.consumer, createRatingSentConsumer()], logger, {
    knownEventTypes: module.eventTypes,
  });
}

async function attemptOf(eventId: string) {
  const row = (
    await f.owner`SELECT id, status, failure_code FROM notification_attempts
    WHERE company_id = ${f.company} AND source_event_id = ${eventId}`
  )[0];
  return row === undefined
    ? null
    : {
        id: String(row['id']),
        status: String(row['status']),
        failureCode: row['failure_code'] === null ? null : String(row['failure_code']),
      };
}

async function resultEventId(attemptId: string, type: string): Promise<string> {
  const row = (
    await f.owner`SELECT id FROM outbox WHERE company_id = ${f.company}
    AND event_type = ${type} AND payload->>'attempt_id' = ${attemptId}`
  )[0];
  if (row === undefined) throw new Error('TEST_RESULT_EVENT_MISSING');
  return String(row['id']);
}

async function requestRow(requestId: string) {
  const row = (
    await f.owner`SELECT status, sent_at, token_hash, send_deadline FROM rating_requests
    WHERE company_id = ${f.company} AND id = ${requestId}`
  )[0];
  if (row === undefined) throw new Error('TEST_REQUEST_MISSING');
  return row;
}

/** كل نص محفوظ في الـ outbox والمحاولات، للتأكد إن الرابط والتوكن ما اتخزنوش. */
async function storedText(): Promise<string> {
  const outbox =
    await f.owner`SELECT payload::text AS t FROM outbox WHERE company_id = ${f.company}`;
  const attempts = await f.owner`SELECT row_to_json(a)::text AS t FROM notification_attempts a
    WHERE company_id = ${f.company}`;
  return [...outbox, ...attempts].map((row) => String(row['t'])).join('\n');
}

function linkOf(channel: {
  readonly calls: readonly { components: readonly { parameters: readonly { text: string }[] }[] }[];
}) {
  const texts = (channel.calls[0]?.components ?? []).flatMap((c) =>
    c.parameters.map((p) => p.text),
  );
  const link = texts.find((text) => text.startsWith(`${ORIGIN}/#`));
  if (link === undefined) throw new Error('TEST_LINK_MISSING');
  return { texts, link, token: link.slice(`${ORIGIN}/#`.length) };
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

it.each([
  { name: 'with the customer first name', customerName: undefined, bodyParameters: 4 },
  { name: 'without a safe customer first name', customerName: '12345678', bodyParameters: 3 },
])(
  'RT-14 RT-14b D-B8 rotated ring sends the stored-version link and SENT follows acceptance $name',
  async ({ customerName, bodyParameters }) => {
    const { requestId, eventId } = await claimedReady(claimDeriver(ENV_V1), customerName);
    const channel = recordingChannel();
    const module = sendModule(channel, ENV_V2);
    const { logger, lines } = recordingLogger();
    const deliver = deliverer(module, logger);

    await deliver(await eventById(eventId));
    const attempt = await attemptOf(eventId);
    expect(attempt?.status).toBe('PENDING');
    await module.send.execute(f.company, attempt?.id ?? '');

    // الرابط اتركّب في الذاكرة بمفتاح الإصدار القديم، وبصمته هي المخزنة في الطلب وقت المطالبة.
    const { texts, token } = linkOf(channel);
    expect(texts).toHaveLength(bodyParameters);
    const stored = await requestRow(requestId);
    expect(Buffer.from(stored['token_hash'] as Buffer).toString('hex')).toBe(sha256(token));
    expect(channel.calls).toHaveLength(1);
    // لا رابط ولا توكن في الـ outbox ولا في المحاولات ولا في السجلات.
    const text = await storedText();
    expect(text).not.toContain(token);
    expect(text).not.toContain('rating.test');
    expect(text).not.toMatch(/https?:/);
    expect(JSON.stringify(lines)).not.toContain(token);
    expect(await requestRow(requestId).then((row) => row['status'])).toBe('SENDING');

    // قبول المزود بيحرّك الطلب إلى SENT بوقت القبول، وإعادة التسليم من غير أثر.
    const deliveredId = await resultEventId(attempt?.id ?? '', 'NotificationDelivered');
    const delivered = await eventById(deliveredId);
    await deliver(delivered);
    const sent = await requestRow(requestId);
    const occurredAt = (delivered.payload as { occurred_at: string }).occurred_at;
    expect(sent['status']).toBe('SENT');
    expect(new Date(String(sent['sent_at'])).toISOString()).toBe(
      new Date(occurredAt).toISOString(),
    );
    const consumer = createRatingSentConsumer();
    f.clock.at = new Date(CLAIM_AT.getTime() + 3_600_000);
    await f.db.withTenant(f.company, (tx) => consumer.handle(tx, delivered));
    const again = await requestRow(requestId);
    expect(again['status']).toBe('SENT');
    expect(new Date(String(again['sent_at'])).toISOString()).toBe(
      new Date(occurredAt).toISOString(),
    );
  },
);

it('D-B8 a cross-tenant NotificationDelivered neither mutates nor leaks another tenant request', async () => {
  const { requestId, eventId } = await claimedReady(claimDeriver(ENV_V1));
  const channel = recordingChannel();
  const module = sendModule(channel, ENV_V2);
  await deliverer(module, recordingLogger().logger)(await eventById(eventId));
  const attempt = await attemptOf(eventId);
  await module.send.execute(f.company, attempt?.id ?? '');
  const real = await eventById(await resultEventId(attempt?.id ?? '', 'NotificationDelivered'));
  const consumer = createRatingSentConsumer();
  const foreignAttempt = f.ids.newId();
  const foreign: ClaimedEvent = {
    ...real,
    companyId: TENANT.B.company,
    aggregateId: foreignAttempt,
    payload: {
      ...(real.payload as object),
      company_id: TENANT.B.company,
      attempt_id: foreignAttempt,
    },
  };
  // نفس معرّف حدث الجاهزية لكن من شركة تانية: ما فيش صف مطابق في RLS، فالطلب بتاعنا ما اتحركش.
  await f.db.withTenant(TENANT.B.company, (tx) => consumer.handle(tx, foreign));
  expect(await requestRow(requestId).then((row) => row['status'])).toBe('SENDING');
  // ظرف مش مطابق للحمولة يترفض بدل ما يتجاهل.
  const mismatched = { ...foreign, companyId: f.company };
  await expect(f.db.withTenant(f.company, (tx) => consumer.handle(tx, mismatched))).rejects.toThrow(
    'RATING_SENT_EVENT_INVALID',
  );
  expect(await requestRow(requestId).then((row) => row['status'])).toBe('SENDING');
});

it('D-B8 a failed delivery leaves the request SENDING', async () => {
  const { requestId, eventId } = await claimedReady(claimDeriver(ENV_V1));
  const rejecting: Channel = {
    send: async (): Promise<ChannelResult> => ({
      kind: 'rejected',
      code: 'PROVIDER_4XX',
      outcomeKnown: true,
    }),
  };
  const module = sendModule(rejecting, ENV_V2);
  const deliver = deliverer(module, recordingLogger().logger);
  await deliver(await eventById(eventId));
  const attempt = await attemptOf(eventId);
  await module.send.execute(f.company, attempt?.id ?? '');
  expect((await attemptOf(eventId))?.status).toBe('FAILED');
  await deliver(await eventById(await resultEventId(attempt?.id ?? '', 'NotificationFailed')));
  expect(await requestRow(requestId).then((row) => row['status'])).toBe('SENDING');
});

it('RT-14b an unknown stored key version fails closed before any send', async () => {
  const { requestId, eventId } = await claimedReady(claimDeriver(ENV_V1, 99));
  const channel = recordingChannel();
  const module = sendModule(channel, ENV_V1);
  await deliverer(module, recordingLogger().logger)(await eventById(eventId));
  const attempt = await attemptOf(eventId);
  expect(attempt?.status).toBe('PENDING');
  await module.send.execute(f.company, attempt?.id ?? '');
  expect(await attemptOf(eventId)).toMatchObject({
    status: 'FAILED',
    failureCode: 'CONFIG_INVALID',
  });
  expect(channel.calls).toHaveLength(0);
  expect(await requestRow(requestId).then((row) => row['status'])).toBe('SENDING');
});

it('RT-04 an event delivered at or after the send deadline is recorded EXPIRED without a send', async () => {
  const { requestId, eventId } = await claimedReady(claimDeriver(ENV_V1));
  const deadline = new Date(String((await requestRow(requestId))['send_deadline']));
  f.clock.at = deadline;
  const channel = recordingChannel();
  const module = sendModule(channel, ENV_V2);
  await deliverer(module, recordingLogger().logger)(await eventById(eventId));
  expect((await attemptOf(eventId))?.status).toBe('EXPIRED');
  expect(channel.calls).toHaveLength(0);
  expect(await requestRow(requestId).then((row) => row['status'])).toBe('SENDING');
});

it('RT-04 an authorized attempt whose deadline passes before the send is recorded EXPIRED', async () => {
  const { requestId, eventId } = await claimedReady(claimDeriver(ENV_V1));
  const deadline = new Date(String((await requestRow(requestId))['send_deadline']));
  const channel = recordingChannel();
  const module = sendModule(channel, ENV_V2);
  await deliverer(module, recordingLogger().logger)(await eventById(eventId));
  const attempt = await attemptOf(eventId);
  expect(attempt?.status).toBe('PENDING');
  f.clock.at = new Date(deadline.getTime() + 1_000);
  await module.send.execute(f.company, attempt?.id ?? '');
  expect((await attemptOf(eventId))?.status).toBe('EXPIRED');
  expect(channel.calls).toHaveLength(0);
  expect(await requestRow(requestId).then((row) => row['status'])).toBe('SENDING');
});
