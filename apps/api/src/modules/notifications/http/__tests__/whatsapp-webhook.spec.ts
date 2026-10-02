import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  config,
  envelope,
  phone,
  providerId,
  remote,
  whatsappHarness,
} from './whatsapp-harness.ts';

let h: Awaited<ReturnType<typeof whatsappHarness>>;
beforeAll(async () => {
  h = await whatsappHarness();
});
beforeEach(async () => {
  await h.resetLimits();
  h.failEnqueue(false);
  h.failScrub(false);
  h.failCommit(undefined);
});
afterAll(async () => {
  await h?.close();
});

// Meta redelivers a retryable unknown commit; each request still uses the real 200 ms facade.
async function deliver(...args: Parameters<typeof h.post>) {
  let response = await h.post(...args);
  for (let attempt = 0; response.statusCode === 503 && attempt < 20; attempt++)
    response = await h.post(...args);
  return response;
}

describe('named public Meta webhook and raw-body signature', () => {
  it('verifies GET challenge as plain text and refuses invalid/missing/duplicate/unbounded values', async () => {
    const url =
      '/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-secret&hub.challenge=12345';
    const response = await h.app.inject({ method: 'GET', url, remoteAddress: remote });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('12345');
    expect(response.headers['content-type']).toContain('text/plain');
    for (const suffix of [
      '',
      '?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=123',
      '?hub.mode=subscribe&hub.verify_token=test-secret&hub.challenge=',
      '?hub.mode=subscribe&hub.verify_token=test-secret&hub.verify_token=test-secret&hub.challenge=123',
    ]) {
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/webhooks/whatsapp${suffix}`,
            remoteAddress: remote,
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  it('verifies original whitespace bytes before parsing even malformed JSON', async () => {
    const body = ` \n${JSON.stringify(envelope('OTHER', 'test.raw-bytes'))}\n`;
    expect((await deliver(body)).statusCode).toBe(200);
    expect((await h.post('{broken', {}, false)).statusCode).toBe(401);
    expect((await h.post('{broken')).statusCode).toBe(400);
    const signature = `sha256=${createHmac('sha256', config.appSecret).update(JSON.stringify(envelope())).digest('hex')}`;
    expect(
      (await h.post(` ${JSON.stringify(envelope())}`, { 'x-hub-signature-256': signature }))
        .statusCode,
    ).toBe(401);
    expect(
      (await h.post(envelope(), { 'x-hub-signature-256': `${signature},${signature}` })).statusCode,
    ).toBe(401);
  });

  it('rejects unsupported encoding/type and caps the original body at 1 MiB', async () => {
    expect((await h.post(envelope(), { 'content-encoding': 'gzip' })).statusCode).toBe(415);
    expect((await h.post(envelope(), { 'content-type': 'text/plain' })).statusCode).toBe(415);
    expect((await h.post('x'.repeat(1_048_577))).statusCode).toBe(413);
  });

  it('checks configured object/WABA/sender without tenant lookup', async () => {
    const wrong = envelope();
    required(wrong.entry[0]).id = '999';
    expect((await h.post(wrong)).statusCode).toBe(200);
    expect((await h.post({ object: 'invalid' })).statusCode).toBe(400);
    const sender = envelope();
    required(required(sender.entry[0]).changes[0]).value.metadata.phone_number_id = '999';
    expect((await h.post(sender)).statusCode).toBe(200);
  });
});

it('commits STOP before enqueue/200 and strips every phone/provider id/free text', async () => {
  expect((await deliver(envelope(), { 'x-request-id': providerId })).statusCode).toBe(200);
  const [row] = await h.owner`SELECT * FROM platform_whatsapp_inbox WHERE command='STOP'`;
  expect(row?.['suppression_applied_at']).not.toBeNull();
  expect(row?.['enqueue_confirmed_at']).not.toBeNull();
  const audit = await h.owner`SELECT inbox_id,source,action,reason FROM platform_whatsapp_audit`;
  expect(audit).toContainEqual({
    inbox_id: row?.['id'],
    source: 'STOP',
    action: 'OPT_OUT',
    reason: 'RECIPIENT_STOP',
  });
  const persisted = JSON.stringify({
    inbox: await h.owner`SELECT * FROM platform_whatsapp_inbox`,
    audit,
    jobs: h.jobs,
    logs: h.chunks,
  });
  for (const forbidden of [
    phone,
    phone.slice(1),
    providerId,
    'test-secret',
    'display_phone_number',
    'context',
    'profile',
    'body',
  ])
    expect(persisted).not.toContain(forbidden);
  expect(h.jobs.every((job) => Object.keys(job).join() === 'inbox_id')).toBe(true);
});

it('concurrent duplicates and enqueue failure return retries without reapplying STOP', async () => {
  const input = envelope('STOP', 'test.enqueue-failure');
  const attempts = h.enqueueAttempts();
  h.failEnqueue(true);
  expect((await h.post(input)).statusCode).toBe(503);
  for (let attempt = 0; h.enqueueAttempts() === attempts && attempt < 20; attempt++)
    expect((await h.post(input)).statusCode).toBe(503);
  expect(h.enqueueAttempts()).toBeGreaterThan(attempts);
  const before = await h.owner`SELECT * FROM platform_whatsapp_suppressions`;
  const count = (await h.owner`SELECT id FROM platform_whatsapp_audit`).length;
  h.failEnqueue(false);
  const results = await Promise.all([deliver(input), deliver(input)]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(await h.owner`SELECT * FROM platform_whatsapp_suppressions`).toEqual(before);
  expect((await h.owner`SELECT id FROM platform_whatsapp_audit`).length).toBe(count);
  expect(h.chunks.join('')).not.toContain(providerId);
});

it('iterates all entries/changes/messages and applies only exact commands/buttons', async () => {
  const data = batchEnvelope();
  expect((await deliver(data)).statusCode).toBe(200);
  const rows =
    await h.owner`SELECT command FROM platform_whatsapp_inbox WHERE raw_event->>'type'='button'`;
  expect(rows).toEqual([{ command: 'STOP' }]);
  const text = JSON.stringify(await h.owner`SELECT raw_event FROM platform_whatsapp_inbox`);
  for (const excluded of [phone, providerId, 'please STOP', 'إلغاء'])
    expect(text).not.toContain(excluded);
});

describe('shared Redis admission', () => {
  it('GET and pre-verification POST have independent IP limits and Retry-After', async () => {
    const digest = createHash('sha256').update(remote).digest('hex');
    await h.redis.set(`rate:whatsapp:ip:GET:${digest}`, 10, 'EX', 60);
    const get = await h.app.inject({
      method: 'GET',
      url: '/v1/webhooks/whatsapp',
      remoteAddress: remote,
    });
    expect([get.statusCode, get.headers['retry-after']]).toEqual([429, '60']);
    await h.redis.set(`rate:whatsapp:ip:POST:${digest}`, 120, 'EX', 60);
    const post = await h.post('{broken', {}, false);
    expect([post.statusCode, post.headers['retry-after']]).toEqual([429, '60']);
  });

  it('verified global phone-number budget is limited after signature verification only', async () => {
    await h.redis.set(`rate:whatsapp:phone-number:${config.phoneNumberId}`, 600, 'EX', 60);
    expect((await h.post(envelope(), {}, false)).statusCode).toBe(401);
    const response = await h.post(envelope());
    expect([response.statusCode, response.headers['retry-after']]).toEqual([429, '60']);
  });

  it('Redis failure returns 503 before storage', async () => {
    h.redis.disconnect();
    expect((await h.post(envelope('STOP', 'test.redis-down'))).statusCode).toBe(503);
    await h.redis.connect();
  });
});

it('digest unavailability and lost commit acknowledgement return 503; unexpected rollback errors return 500 without privacy fallback', async () => {
  const count = (await h.owner`SELECT id FROM platform_whatsapp_inbox`).length;
  h.failScrub(true);
  expect((await h.post(envelope('STOP', 'test.digest-unavailable'))).statusCode).toBe(503);
  expect((await h.owner`SELECT id FROM platform_whatsapp_inbox`).length).toBe(count);
  h.failScrub(false);
  h.failCommit('rollback');
  expect((await h.post(envelope('STOP', 'test.rollback'))).statusCode).toBe(500);
  expect((await h.owner`SELECT id FROM platform_whatsapp_inbox`).length).toBe(count);
  h.failCommit('unknown');
  const auditCount = (await h.owner`SELECT id FROM platform_whatsapp_audit`).length;
  const input = envelope('STOP', 'test.unknown-commit');
  expect((await h.post(input)).statusCode).toBe(503);
  const audit = await committedAudit(auditCount + 1);
  const suppression = await h.owner`SELECT * FROM platform_whatsapp_suppressions`;
  h.failCommit(undefined);
  expect((await deliver(input)).statusCode).toBe(200);
  expect(await h.owner`SELECT * FROM platform_whatsapp_audit`).toEqual(audit);
  expect(await h.owner`SELECT * FROM platform_whatsapp_suppressions`).toEqual(suppression);
  expect(h.chunks.join('')).not.toContain(providerId);
});

async function committedAudit(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await h.owner`SELECT * FROM platform_whatsapp_audit`;
    if (rows.length === count) return rows;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('TEST_COMMITTED_AUDIT_MISSING');
}

it('bounds shared concurrency and prevents untrusted forwarded IPs from bypassing admission', async () => {
  const now = Date.now() + 30_000;
  const reservations = Array.from({ length: 32 }, (_, i) => `test-slot-${i}`);
  try {
    for (const id of reservations) await h.redis.zadd('whatsapp:concurrency', now, id);
    expect((await h.post(envelope('OTHER', 'test.full-concurrency'))).statusCode).toBe(429);
  } finally {
    await h.redis.zrem('whatsapp:concurrency', ...reservations);
  }
  const digest = createHash('sha256').update(remote).digest('hex');
  await h.redis.set(`rate:whatsapp:ip:POST:${digest}`, 120, 'EX', 60);
  expect((await h.post(envelope(), { 'x-forwarded-for': '192.0.2.42' })).statusCode).toBe(429);
});

it('a privilege failure is INTERNAL_ERROR and rolls back all durable webhook effects', async () => {
  const before = await h.owner`SELECT id FROM platform_whatsapp_inbox`;
  try {
    await h.owner`REVOKE UPDATE (last_opted_out_at) ON platform_whatsapp_suppressions FROM pospay_notifications`;
    expect((await h.post(envelope('STOP', 'test.privilege-error'))).statusCode).toBe(500);
  } finally {
    await h.owner`GRANT UPDATE (last_opted_out_at) ON platform_whatsapp_suppressions TO pospay_notifications`;
  }
  expect(await h.owner`SELECT id FROM platform_whatsapp_inbox`).toEqual(before);
  for (const forbidden of [providerId, phone, 'test-secret'])
    expect(h.chunks.join('')).not.toContain(forbidden);
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('TEST_FIXTURE_MISSING');
  return value;
}

function batchEnvelope() {
  const inputs = [
    'UNSUBSCRIBE',
    'إيقاف',
    'ايقاف',
    'توقف',
    'CANCEL',
    'إلغاء',
    'الغاء',
    'START',
    'please STOP',
  ];
  const batch = envelope('OTHER', 'test.batch');
  const value = required(required(batch.entry[0]).changes[0]).value;
  const messages = inputs.map((text, i) => ({
    ...required(value.messages[0]),
    id: `test.batch.${i}`,
    text: { body: text },
  }));
  return {
    ...batch,
    entry: [
      { ...batch.entry[0], changes: [{ field: 'messages', value: { ...value, messages } }] },
      {
        id: config.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              ...value,
              messages: [
                {
                  ...value.messages[0],
                  id: 'test.button',
                  type: 'button',
                  text: undefined,
                  button: { payload: config.stopButtonId, text: 'unknown' },
                },
              ],
            },
          },
          {
            field: 'messages',
            value: {
              ...value,
              messages: [],
              statuses: [{ id: providerId, recipient_id: phone }],
            },
          },
        ],
      },
    ],
  };
}
