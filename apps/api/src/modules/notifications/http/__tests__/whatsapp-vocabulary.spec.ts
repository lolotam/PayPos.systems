import { createHash, createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPhoneIdentity, createProviderMessageDigest } from '@pospay/notifications';
import { config, whatsappHarness } from './whatsapp-harness.ts';

const remote = '127.0.0.88';
let h: Awaited<ReturnType<typeof whatsappHarness>>;
let appSql: postgres.Sql;

beforeAll(async () => {
  h = await whatsappHarness();
  appSql = postgres(h.test.appUrl, { max: 1, onnotice: () => undefined });
});

beforeEach(async () => {
  const digest = createHash('sha256').update(remote).digest('hex');
  await h.redis.del(`rate:whatsapp:ip:POST:${digest}`, `rate:whatsapp:phone-number:${config.phoneNumberId}`);
  h.failEnqueue(false);
  h.failScrub(false);
  h.failCommit(undefined);
});

afterAll(async () => {
  await appSql?.end();
  await h?.close();
});

function postMessage(app: NestFastifyApplication, body: unknown) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', config.appSecret).update(Buffer.from(payload)).digest('hex')}`;
  return app.inject({
    method: 'POST',
    url: '/v1/webhooks/whatsapp',
    remoteAddress: remote,
    payload,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    },
  });
}

async function deliver(app: NestFastifyApplication, body: unknown) {
  let response = await postMessage(app, body);
  for (let attempt = 0; response.statusCode === 503 && attempt < 20; attempt++)
    response = await postMessage(app, body);
  return response;
}

interface MessageItem {
  phone: string;
  wamid: string;
  text?: string | undefined;
  buttonPayload?: string | undefined;
}

function makeEnvelope(item: MessageItem) {
  const isButton = item.buttonPayload !== undefined;
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: config.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                phone_number_id: config.phoneNumberId,
                display_phone_number: item.phone,
              },
              contacts: [{ wa_id: item.phone, profile: { name: item.phone } }],
              messages: [
                {
                  id: item.wamid,
                  from: item.phone.replace(/^\+/, ''),
                  timestamp: '1790848800',
                  type: isButton ? 'button' : 'text',
                  ...(isButton
                    ? { button: { payload: item.buttonPayload } }
                    : { text: { body: item.text ?? '' } }),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('STOP vocabulary suppresses recipient in database', () => {
  const validStops: MessageItem[] = [
    { text: 'STOP', phone: '+96500000010', wamid: 'test.stop.1' },
    { text: 'stop', phone: '+96500000011', wamid: 'test.stop.2' },
    { text: ' \nStOp\t', phone: '+96500000012', wamid: 'test.stop.3' },
    { text: 'ＳＴＯＰ', phone: '+96500000013', wamid: 'test.stop.4' },
    { text: 'UNSUBSCRIBE', phone: '+96500000014', wamid: 'test.stop.5' },
    { text: 'unsubscribe', phone: '+96500000015', wamid: 'test.stop.6' },
    { text: 'إيقاف', phone: '+96500000016', wamid: 'test.stop.7' },
    { text: 'ايقاف', phone: '+96500000017', wamid: 'test.stop.8' },
    { text: 'توقف', phone: '+96500000018', wamid: 'test.stop.9' },
    { buttonPayload: config.stopButtonId, phone: '+96500000019', wamid: 'test.stop.10' },
  ];

  it.each(validStops)('suppresses for $text or button $buttonPayload', async (item) => {
    const res = await deliver(h.app, makeEnvelope(item));
    expect(res.statusCode).toBe(200);

    const identity = createPhoneIdentity(config.phoneHashKey, config.hashKeyId);
    const hash = Buffer.from(identity.identify(item.phone).hash);

    const rows = await h.owner`
      SELECT recipient_hash, source FROM platform_whatsapp_suppressions
      WHERE recipient_hash = ${hash}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['source']).toBe('STOP');

    const [isSuppressed] = await appSql<{ value: boolean }[]>`
      SELECT platform_whatsapp_is_suppressed(${hash}) AS value
    `;
    expect(isSuppressed?.value).toBe(true);

    const audit = await h.owner`
      SELECT source, action, reason FROM platform_whatsapp_audit
      WHERE recipient_hash = ${hash}
    `;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      source: 'STOP',
      action: 'OPT_OUT',
      reason: 'RECIPIENT_STOP',
    });
  });
});

describe('Non-STOP inputs do not suppress recipient', () => {
  const nonStops: MessageItem[] = [
    { text: 'CANCEL', phone: '+96500000020', wamid: 'test.other.1' },
    { text: 'إلغاء', phone: '+96500000021', wamid: 'test.other.2' },
    { text: 'الغاء', phone: '+96500000022', wamid: 'test.other.3' },
    { text: 'please STOP', phone: '+96500000023', wamid: 'test.other.4' },
    { text: 'STOP now', phone: '+96500000024', wamid: 'test.other.5' },
    { buttonPayload: 'unknown-button-id', phone: '+96500000025', wamid: 'test.other.6' },
  ];

  it.each(nonStops)('does not suppress for $text or button $buttonPayload', async (item) => {
    const res = await deliver(h.app, makeEnvelope(item));
    expect(res.statusCode).toBe(200);

    const identity = createPhoneIdentity(config.phoneHashKey, config.hashKeyId);
    const hash = Buffer.from(identity.identify(item.phone).hash);

    const rows = await h.owner`
      SELECT recipient_hash FROM platform_whatsapp_suppressions
      WHERE recipient_hash = ${hash}
    `;
    expect(rows).toHaveLength(0);

    const [isSuppressed] = await appSql<{ value: boolean }[]>`
      SELECT platform_whatsapp_is_suppressed(${hash}) AS value
    `;
    expect(isSuppressed?.value).toBe(false);

    const audit = await h.owner`
      SELECT id FROM platform_whatsapp_audit
      WHERE recipient_hash = ${hash}
    `;
    expect(audit).toHaveLength(0);
  });
});

describe('Privacy and HMAC message key verification', () => {
  it('stores HMAC digest as message key without leaking phone, wamid or secrets', async () => {
    const phone = '+96500000030';
    const wamid = `test.wamid.privacy.${Buffer.from(phone).toString('base64')}`;
    const res = await deliver(h.app, makeEnvelope({ phone, wamid, text: 'STOP' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    const messageDigest = createProviderMessageDigest(config.messageHashKey, config.hashKeyId)(wamid);
    const phoneIdentity = createPhoneIdentity(config.phoneHashKey, config.hashKeyId).identify(phone);

    const [inboxRow] = await h.owner`
      SELECT * FROM platform_whatsapp_inbox
      WHERE provider_message_digest = ${Buffer.from(messageDigest)}
    `;
    expect(inboxRow).toBeDefined();
    expect(inboxRow?.['recipient_hash']).toEqual(Buffer.from(phoneIdentity.hash));
    expect(inboxRow?.['provider_message_digest']).toEqual(Buffer.from(messageDigest));

    const [auditRow] = await h.owner`
      SELECT * FROM platform_whatsapp_audit
      WHERE inbox_id = ${inboxRow?.['id']}
    `;
    expect(auditRow).toBeDefined();

    const storedData = JSON.stringify({
      inbox: inboxRow,
      audit: auditRow,
      jobs: h.jobs,
      logs: h.chunks,
      response: res.body,
    });

    for (const secret of [phone, phone.slice(1), wamid, config.appSecret, config.verifyToken]) {
      expect(storedData).not.toContain(secret);
    }
  });
});
