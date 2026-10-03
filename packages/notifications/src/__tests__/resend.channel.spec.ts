import { afterEach, beforeEach, expect, it } from 'vitest';
import { ResendChannel } from '../adapters/resend.channel.ts';
import { EMAIL_ENV, EMAIL_REQUEST, NOW, PROVIDER_ID, resendHarness } from './resend-harness.ts';

let h: Awaited<ReturnType<typeof resendHarness>>;
beforeEach(async () => {
  h = await resendHarness();
});
afterEach(async () => {
  await h.close();
});

it.each(['ar', 'en'] as const)(
  'sends one safe %s operational email to the fixed origin',
  async (locale) => {
    const channel = h.channel();
    expect(await channel.send({ ...EMAIL_REQUEST, locale })).toEqual({
      kind: 'accepted',
      providerMessageId: PROVIDER_ID,
    });
    expect(h.state.calls).toBe(1);
    expect(h.state.origins).toEqual(['https://api.resend.com/emails']);
    expect(h.state.headers['authorization']).toBe(`Bearer ${EMAIL_ENV.RESEND_API_KEY}`);
    expect(h.state.body).toMatchObject({
      from: `Synthetic sender <${EMAIL_ENV.EMAIL_FROM_ADDRESS}>`,
      to: [EMAIL_REQUEST.email],
      reply_to: EMAIL_ENV.EMAIL_REPLY_TO,
      tags: [
        { name: 'company_id', value: EMAIL_REQUEST.companyId },
        { name: 'attempt_id', value: EMAIL_REQUEST.attemptId },
        { name: 'execution_id', value: EMAIL_REQUEST.executionId },
      ],
    });
    expect(h.state.body['subject']).toBe(
      locale === 'ar' ? 'تنبيه انتهاء مستند' : 'Document expiry alert',
    );
    expect(h.state.body['html']).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
    expect(h.state.body['text']).toContain('https://app.pospay.systems/');
    expect(Object.keys(h.state.body)).not.toEqual(
      expect.arrayContaining(['attachments', 'cc', 'bcc', 'tracking']),
    );
    expect(JSON.stringify(channel)).not.toContain(EMAIL_ENV.RESEND_API_KEY);
  },
);

it.each([400, 401, 403, 429, 500, 503, 302])(
  'HTTP %s has bounded diagnostics, zero redirects and no retry',
  async (status) => {
    h.state.status = status;
    h.state.reply = JSON.stringify({
      message: EMAIL_REQUEST.email,
      body: 'private body',
      token: EMAIL_ENV.RESEND_API_KEY,
    });
    const result = await h.channel().send(EMAIL_REQUEST);
    expect(result.kind).toBe(status >= 400 && status < 500 ? 'rejected' : 'unknown');
    expect(h.state.calls).toBe(1);
    for (const value of [EMAIL_REQUEST.email, 'private body', EMAIL_ENV.RESEND_API_KEY])
      expect(JSON.stringify(result)).not.toContain(value);
  },
);

it.each(['{}', 'null', 'not json', JSON.stringify({ id: 'bad/provider/id' }), 'x'.repeat(17000)])(
  'invalid response remains unknown',
  async (reply) => {
    h.state.reply = reply;
    expect(await h.channel().send(EMAIL_REQUEST)).toMatchObject({
      kind: 'unknown',
      code: 'RESPONSE_INVALID',
      outcomeKnown: false,
    });
    expect(h.state.calls).toBe(1);
  },
);

it('bounds timeouts without resubmission', async () => {
  h.state.hang = true;
  expect(await h.channel(() => NOW, 100).send(EMAIL_REQUEST)).toMatchObject({
    kind: 'unknown',
    code: 'NETWORK_UNKNOWN',
    outcomeKnown: false,
  });
  expect(h.state.calls).toBe(1);
});

it('checks the deadline immediately before submission with no intervening await', async () => {
  let checks = 0;
  const channel = h.channel(() => new Date(NOW.getTime() + (checks++ === 0 ? 0 : 1000)));
  expect(await channel.send({ ...EMAIL_REQUEST, deadline: new Date(NOW.getTime() + 500) })).toEqual(
    { kind: 'expired' },
  );
  expect(h.state.origins).toEqual([]);
});

it('rejects invalid destination/template/locale/correlation without HTTP', async () => {
  for (const input of [
    { ...EMAIL_REQUEST, email: 'two@example.invalid,other@example.invalid' },
    { ...EMAIL_REQUEST, templateKey: 'staff_otp' },
    { ...EMAIL_REQUEST, locale: 'fr' as 'ar' },
    { ...EMAIL_REQUEST, executionId: '' },
    { ...EMAIL_REQUEST, safeParameters: ['private body'] },
  ])
    await expect(h.channel().send(input)).rejects.toThrow('EMAIL_REQUEST_INVALID');
  expect(h.state.origins).toEqual([]);
});

it('hides thrown transport diagnostics and validates the sender domain', async () => {
  const channel = new ResendChannel({
    env: EMAIL_ENV,
    now: () => NOW,
    request: (() => {
      throw new Error(EMAIL_REQUEST.email);
    }) as never,
  });
  expect(await channel.send(EMAIL_REQUEST)).toMatchObject({
    kind: 'unknown',
    code: 'NETWORK_UNKNOWN',
  });
  expect(
    () =>
      new ResendChannel({
        env: { ...EMAIL_ENV, EMAIL_FROM_ADDRESS: 'synthetic@other.invalid' },
        now: () => NOW,
      }),
  ).toThrow('EMAIL_PROVIDER_CONFIG_INVALID');
});
