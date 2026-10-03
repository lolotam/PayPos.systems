import { readFileSync } from 'node:fs';
import { createServer, request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { ResendChannel } from '../adapters/resend.channel.ts';
import type { EmailRequest } from '../email-request.ts';

export const NOW = new Date('2026-10-03T00:00:00Z');
export const PROVIDER_ID = '01920000-0000-7000-8000-000000000004';
export const EMAIL_REQUEST: EmailRequest = {
  email: 'synthetic.owner@example.invalid',
  locale: 'ar',
  templateKey: 'document_expiring',
  templateRevision: 1,
  safeParameters: [],
  companyId: '01920000-0000-7000-8000-000000000001',
  attemptId: '01920000-0000-7000-8000-000000000002',
  executionId: '01920000-0000-7000-8000-000000000003',
  deadline: null,
};
export const EMAIL_ENV = {
  RESEND_API_KEY: 'synthetic-test-only',
  EMAIL_FROM_ADDRESS: 'synthetic@send.pospay.systems',
  EMAIL_FROM_NAME: 'Synthetic sender',
  EMAIL_REPLY_TO: 'synthetic.replies@example.invalid',
  EMAIL_ADMIN_ORIGIN: 'https://app.pospay.systems',
};

export async function resendHarness() {
  // شهادة ومفتاح مصطنعان منشوران لاختبار loopback فقط؛ ليسا بيانات تشغيل.
  const cert = readFileSync(new URL('./fixtures/loopback-cert.pem', import.meta.url));
  const key = readFileSync(new URL('./fixtures/loopback-key.pem', import.meta.url));
  const state = {
    calls: 0,
    status: 200,
    reply: JSON.stringify({ id: PROVIDER_ID }),
    hang: false,
    body: {} as Record<string, unknown>,
    headers: {} as IncomingMessage['headers'],
    origins: [] as string[],
  };
  const server = createServer({ cert, key }, async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
    state.calls += 1;
    state.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    state.headers = req.headers;
    if (!state.hang) {
      res.writeHead(state.status, {
        'content-type': 'application/json',
        location: '/redirect-target',
      });
      res.end(state.reply);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS');
  const transport = ((
    url: string | URL,
    options: RequestOptions,
    callback: (r: IncomingMessage) => void,
  ) => {
    state.origins.push(String(url));
    return request(`https://127.0.0.1:${address.port}/emails`, { ...options, ca: cert }, callback);
  }) as typeof request;
  return {
    state,
    channel: (now = () => NOW, timeoutMs = 1000) =>
      new ResendChannel({ env: EMAIL_ENV, now, request: transport, timeoutMs }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
