import {
  createProviderMessageDigest,
  type Channel,
  type EmailRequest,
} from '@pospay/notifications';
import { describe, expect, it } from 'vitest';
import { createEmailOtpChannel } from './otp-email-channel.adapter.ts';
import { createOtpChannel } from './otp-channel.adapter.ts';
import type { OtpPending } from '../ports/otp-execution.port.ts';

// القالب بيتحدد من سجل المحاولة نفسه: اعتماد الرقم السري ليه قالبه، وما بيخرجش بقالب كلمة المرور
// ولا بقالب دخول الواتساب (spec 079 PR-c1).
const pending = (templateKey: string, over: Partial<OtpPending> = {}): OtpPending => ({
  id: 'synthetic-attempt',
  challengeId: 'synthetic-challenge',
  recipientHash: Buffer.alloc(32),
  locale: 'en',
  channel: 'EMAIL',
  templateKey,
  providerTemplateName: null,
  status: 'SENDING',
  preparationDeadline: new Date(200),
  sendDeadline: new Date(600000),
  ...over,
});
const material = {
  destination: 'sara@example.invalid',
  code: '123456',
  deadline: new Date(600000),
  executionId: 'synthetic-execution',
};

function email() {
  const sent: EmailRequest[] = [];
  const channel: Channel<EmailRequest> = {
    send: async (request: EmailRequest) => {
      sent.push(request);
      return { kind: 'accepted', providerMessageId: 'synthetic-message' };
    },
  } as Channel<EmailRequest>;
  const adapter = createEmailOtpChannel(
    channel,
    { available: () => true, ready: async () => true },
    createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h'),
    () => new Date(0),
  );
  return { adapter, sent };
}

describe('the email channel picks the template from the attempt', () => {
  it.each([
    ['password_reset_otp', 'password_reset_otp'],
    ['staff_pin_reset_otp', 'staff_pin_reset_otp'],
  ])('sends %s on its own template with the recipient only in memory', async (key, expected) => {
    const { adapter, sent } = email();
    expect(adapter.valid(pending(key))).toBe(true);
    const result = await adapter.send(pending(key), material);
    expect(result.status).toBe('SENT');
    expect(sent[0]).toMatchObject({ templateKey: expected, templateRevision: 1 });
    expect(JSON.stringify(result)).not.toContain(material.destination);
    expect(JSON.stringify(result)).not.toContain(material.code);
  });

  it('refuses an unknown template and a provider template name', () => {
    const { adapter } = email();
    expect(adapter.valid(pending('staff_otp'))).toBe(false);
    expect(adapter.valid(pending('staff_pin_reset_otp', { providerTemplateName: 'x' }))).toBe(
      false,
    );
  });
});

describe('the WhatsApp channel keeps to the staff login template', () => {
  it('refuses a PIN recovery attempt until its own template is approved', () => {
    const approval = {
      names: { ar: 'synthetic_ar', en: 'synthetic_en' },
      components: { ar: [{ type: 'body' as const }], en: [{ type: 'body' as const }] },
    };
    const channel = createOtpChannel(
      {} as never,
      approval as never,
      { available: () => true, ready: async () => true },
      createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h'),
      () => new Date(0),
    );
    const login = pending('staff_otp', {
      channel: 'WHATSAPP',
      providerTemplateName: 'synthetic_en',
    });
    expect(channel.valid(login)).toBe(true);
    expect(channel.valid({ ...login, templateKey: 'staff_pin_reset_otp' })).toBe(false);
  });
});
