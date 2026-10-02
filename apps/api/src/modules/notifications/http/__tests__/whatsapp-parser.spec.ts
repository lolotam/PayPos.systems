import type * as NotificationPackage from '@pospay/notifications';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Controller, Post, Req } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { verifyWhatsappSignature } from '@pospay/notifications';
import { createApp } from '../../../../app.ts';
import { Public } from '../../../../shared/public.decorator.ts';
import { config, envelope } from './whatsapp-harness.ts';
import { createWhatsappEnvelopeAdapter } from '../../persistence/whatsapp-envelope.adapter.ts';
import { ReceiveWhatsappStop } from '../../use-cases/receive-whatsapp-stop/receive-whatsapp-stop.ts';

vi.mock('@pospay/notifications', async (original) => {
  const actual = await original<typeof NotificationPackage>();
  return { ...actual, verifyWhatsappSignature: vi.fn(actual.verifyWhatsappSignature) };
});

@Controller('test-parser')
class ParserProbe {
  @Public()
  @Post()
  post(@Req() request: FastifyRequest & { rawBody?: unknown }) {
    return { raw: request.rawBody !== undefined, parsed: request.body !== undefined };
  }
}
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  const receive = new ReceiveWhatsappStop(
    { accept: async () => [], confirmEnqueue: async () => undefined },
    { enqueue: async () => undefined },
    { now: () => new Date('2026-10-01T10:00:00Z') },
  );
  app = await createApp(
    {
      readiness: [],
      redis: { eval: async () => 1, zrem: async () => 1 } as unknown as Redis,
      whatsapp: { config, receive, scrub: createWhatsappEnvelopeAdapter(config) },
    },
    { controllers: [ParserProbe] },
  );
});
beforeEach(() => {
  vi.mocked(verifyWhatsappSignature).mockClear();
});
afterAll(async () => {
  await app?.close();
});

it('verifies the original signed bytes once and relies on that result in the controller', async () => {
  const payload = ` \n${JSON.stringify(envelope())}\n`;
  const signature = `sha256=${createHmac('sha256', config.appSecret).update(payload).digest('hex')}`;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/webhooks/whatsapp',
        payload,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      })
    ).statusCode,
  ).toBe(200);
  expect(verifyWhatsappSignature).toHaveBeenCalledTimes(1);
  expect(vi.mocked(verifyWhatsappSignature).mock.calls[0]?.[0]).toEqual(Buffer.from(payload));
});

it('leaves ordinary JSON and form parsing without raw-body capture or signature checks', async () => {
  for (const [type, payload] of [
    ['application/json', '{"test":true}'],
    ['application/x-www-form-urlencoded', 'test=true'],
  ] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/test-parser',
      payload,
      headers: { 'content-type': type },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ raw: false, parsed: true });
  }
  expect(verifyWhatsappSignature).not.toHaveBeenCalled();
});
