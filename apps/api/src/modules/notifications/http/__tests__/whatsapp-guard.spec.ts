import { WhatsappEnvelopeInvalidError } from '@pospay/contracts';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { envelope, providerId, phone, whatsappHarness } from './whatsapp-harness.ts';

let h: Awaited<ReturnType<typeof whatsappHarness>>;
beforeAll(async () => {
  h = await whatsappHarness();
});
beforeEach(async () => {
  await h.resetLimits();
  h.failCommit(undefined);
  h.chunks.length = 0;
});
afterAll(async () => {
  await h?.close();
});

it('logs only error class and Postgres code for known transients and sends unexpected errors to the filter', async () => {
  for (const failure of ['lock', 'deadline', 'unexpected'] as const) {
    h.failCommit(failure);
    const response = await h.post(envelope('STOP', `test.guard.${failure}`));
    expect(response.statusCode).toBe(failure === 'unexpected' ? 500 : 503);
  }
  const logs = h.chunks.map((line) => JSON.parse(line) as Record<string, unknown>);
  const failures = logs.filter((line) => line['msg'] === 'whatsapp intake failed');
  expect(failures).toHaveLength(3);
  expect(failures[0]).toMatchObject({ type: 'PostgresError', pgCode: '55P03' });
  expect(failures[1]).toMatchObject({ type: 'TimeoutError' });
  expect(failures[2]).toMatchObject({ type: 'TypeError' });
  expect(logs.some((line) => line['msg'] === 'unhandled error')).toBe(true);
  for (const input of [providerId, phone, 'test-secret'])
    expect(h.chunks.join('')).not.toContain(input);
});

it('logs one warning for Redis rate, concurrency, verified budget and release failures', async () => {
  const original = h.redis.eval.bind(h.redis);
  for (const position of [1, 2, 3]) {
    h.chunks.length = 0;
    let calls = 0;
    const spy = vi.spyOn(h.redis, 'eval').mockImplementation((...args) => {
      if (++calls === position) return Promise.reject(new Error(providerId));
      return original(...args);
    });
    try {
      expect((await h.post(envelope('OTHER', `test.redis.${position}`))).statusCode).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect(h.chunks.filter((line) => line.includes('whatsapp redis unavailable'))).toHaveLength(1);
  }
  h.chunks.length = 0;
  const release = vi.spyOn(h.redis, 'zrem').mockRejectedValue(new Error(providerId));
  try {
    const result = await h.post(envelope('OTHER', 'test.release'));
    expect([200, 503]).toContain(result.statusCode);
    expect(h.chunks.filter((line) => line.includes('whatsapp redis unavailable'))).toHaveLength(1);
  } finally {
    release.mockRestore();
    await h.redis.del('whatsapp:concurrency');
  }
  expect(h.chunks.join('')).not.toContain(providerId);
});

it('keeps a valid STOP when a signed batch contains another field, WABA or sender', async () => {
  const valid = envelope('STOP', 'test.mixed-stop');
  const entry = valid.entry[0];
  if (entry === undefined) throw new Error('TEST_ENTRY_MISSING');
  const change = entry.changes[0];
  if (change === undefined) throw new Error('TEST_CHANGE_MISSING');
  const mixed = {
    ...valid,
    entry: [
      {
        ...entry,
        changes: [
          { field: 'unexpected', value: { phone } },
          change,
          { ...change, value: { ...change.value, metadata: { phone_number_id: '999' } } },
        ],
      },
      { ...entry, id: '999' },
    ],
  };
  let result = await h.post(mixed);
  for (let retry = 0; result.statusCode === 503 && retry < 20; retry++)
    result = await h.post(mixed);
  expect(result.statusCode).toBe(200);
  const rows =
    await h.owner`SELECT command,suppression_applied_at FROM platform_whatsapp_inbox WHERE command = 'STOP'`;
  expect(rows).toEqual([{ command: 'STOP', suppression_applied_at: expect.any(Date) }]);
  const logs = h.chunks.map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(logs).toContainEqual(
    expect.objectContaining({ msg: 'whatsapp changes skipped', skipped: 3 }),
  );
  for (const input of [phone, providerId]) expect(h.chunks.join('')).not.toContain(input);
});

it('recognises envelope errors by class and treats matching message text as unexpected', async () => {
  const scrub = vi.spyOn(h.whatsapp, 'scrub');
  try {
    scrub.mockImplementation(() => {
      throw new WhatsappEnvelopeInvalidError();
    });
    expect((await h.post(envelope())).statusCode).toBe(400);
    scrub.mockImplementation(() => {
      throw new Error('WHATSAPP_ENVELOPE_INVALID');
    });
    expect((await h.post(envelope())).statusCode).toBe(500);
  } finally {
    scrub.mockRestore();
  }
});
