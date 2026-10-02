import { describe, expect, it, vi } from 'vitest';

import { FakeChannel } from '../adapters/fake.channel.ts';
import { WhatsAppChannel } from '../adapters/whatsapp.channel.ts';
import type { ChannelRequest } from '../channel.ts';

const now = new Date('2026-10-01T10:00:00Z');
const request: ChannelRequest = {
  phone: '+96500000001',
  locale: 'ar',
  providerTemplateName: 'test_notice',
  components: [],
  deadline: null,
};

it.each(['refused', 'failure'])(
  'beforeSubmit %s is a known local refusal with zero HTTP',
  async (outcome) => {
    const http = vi.fn<typeof fetch>();
    const channel = new WhatsAppChannel({
      accessToken: 'synthetic',
      phoneNumberId: '00000001',
      now: () => now,
      request: http,
      beforeSubmit: async () => {
        if (outcome === 'failure') throw new Error('SYNTHETIC_CAPABILITY_FAILURE');
        return false;
      },
    });
    expect(await channel.send(request)).toEqual({
      kind: 'refused',
      code: 'CAPABILITY_UNAVAILABLE',
      outcomeKnown: true,
    });
    expect(http).not.toHaveBeenCalled();
  },
);

describe('fake one-submission channel', () => {
  it.each(['accepted', '4xx', '429', '5xx', 'timeout'] as const)(
    '%s returns bounded diagnostics',
    async (outcome) => {
      const fake = new FakeChannel(() => now);
      fake.outcome = outcome;
      const result = await fake.send(request);
      expect(fake.calls).toBe(1);
      expect(result.kind).toBe(
        outcome === 'accepted'
          ? 'accepted'
          : ['4xx', '429'].includes(outcome)
            ? 'rejected'
            : 'unknown',
      );
      expect(JSON.stringify(result)).not.toContain(request.phone);
    },
  );
  it('expiry at the last hook makes zero submissions', async () => {
    let time = now;
    const fake = new FakeChannel(() => time, {
      beforeSubmission: () => {
        time = new Date(now.getTime() + 1_000);
      },
    });
    expect(await fake.send({ ...request, deadline: new Date(now.getTime() + 500) })).toEqual({
      kind: 'expired',
    });
    expect(fake.calls).toBe(0);
  });
});

describe('Meta adapter contract', () => {
  it('pins origin/version, language and template body, denies redirects and calls once', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] })));
    const channel = new WhatsAppChannel({
      accessToken: 'test-token',
      phoneNumberId: '00000001',
      now: () => now,
      request: http,
    });
    expect(await channel.send(request)).toEqual({
      kind: 'accepted',
      providerMessageId: 'wamid.test',
    });
    expect(http).toHaveBeenCalledOnce();
    const [url, options] = http.mock.calls[0] ?? [];
    expect(url).toBe('https://graph.facebook.com/v23.0/00000001/messages');
    expect(options?.redirect).toBe('error');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      to: request.phone,
      type: 'template',
      template: { language: { code: 'ar' } },
    });
  });
  it.each([400, 429, 500])('HTTP %s never retries', async (status) => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('body deliberately ignored', { status }));
    const channel = new WhatsAppChannel({
      accessToken: 'test-token',
      phoneNumberId: '00000001',
      now: () => now,
      request: http,
    });
    const result = await channel.send(request);
    expect(result.kind).toBe(status < 500 ? 'rejected' : 'unknown');
    expect(http).toHaveBeenCalledOnce();
  });
  it('network errors and malformed success become unknown without raw diagnostic text', async () => {
    for (const http of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error(request.phone)),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
    ]) {
      const result = await new WhatsAppChannel({
        accessToken: 'test-token',
        phoneNumberId: '00000001',
        now: () => now,
        request: http,
      }).send(request);
      expect(result.kind).toBe('unknown');
      expect(JSON.stringify(result)).not.toContain(request.phone);
      expect(http).toHaveBeenCalledOnce();
    }
  });
});
