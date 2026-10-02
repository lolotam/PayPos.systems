import {
  createProviderMessageDigest,
  FakeChannel,
  type FakeOutcome,
  type OtpTemplateApproval,
} from '@pospay/notifications';
import { expect, it } from 'vitest';
import { createOtpChannel } from './otp-channel.adapter.ts';
import type { OtpPending } from '../ports/otp-execution.port.ts';

const approval: OtpTemplateApproval = {
  names: { ar: 'synthetic_ar', en: 'synthetic_en' },
  components: {
    ar: [{ type: 'body' }, { type: 'button', sub_type: 'url', index: '0' }],
    en: [{ type: 'body' }, { type: 'button', sub_type: 'url', index: '0' }],
  },
};
const attempt: OtpPending = {
  id: 'synthetic-attempt',
  challengeId: 'synthetic-challenge',
  recipientHash: Buffer.alloc(32),
  locale: 'ar',
  providerTemplateName: 'synthetic_ar',
  status: 'SENDING',
  preparationDeadline: new Date(200),
  sendDeadline: new Date(300000),
};
const material = {
  phone: '+99900000001',
  code: String(7).padStart(6, '0'),
  deadline: new Date(300000),
};

it.each(['accepted', '4xx', '429', '5xx', 'timeout'] as FakeOutcome[])(
  'records %s without retaining destination, code or provider identifier',
  async (outcome) => {
    const fake = new FakeChannel(() => new Date(0));
    fake.outcome = outcome;
    const adapter = createOtpChannel(
      fake,
      approval,
      { ready: async () => true },
      createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h'),
      () => new Date(0),
    );
    const result = await adapter.send(attempt, material);
    expect(fake.calls).toBe(1);
    expect(result.status).toBe(outcome === 'accepted' ? 'SENT' : 'FAILED');
    if (outcome === 'accepted') expect(result.providerMessageDigest).toHaveLength(32);
    expect(JSON.stringify(result)).not.toContain(material.phone);
    expect(JSON.stringify(result)).not.toContain(material.code);
    expect(JSON.stringify(result)).not.toContain('fake-message-id');
  },
);

it('checks expiry again after asynchronous capability validation', async () => {
  let now = 0;
  const fake = new FakeChannel(() => new Date(now));
  const adapter = createOtpChannel(
    fake,
    approval,
    {
      ready: async () => {
        now = 300000;
        return true;
      },
    },
    createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h'),
    () => new Date(now),
  );
  expect((await adapter.send(attempt, material)).status).toBe('FAILED');
  expect(fake.calls).toBe(0);
});

it('capability loss and a wrong locale/template never reach provider submission', async () => {
  const fake = new FakeChannel(() => new Date(0));
  const adapter = createOtpChannel(
    fake,
    approval,
    { ready: async () => false },
    createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h'),
    () => new Date(0),
  );
  expect((await adapter.send(attempt, material)).status).toBe('FAILED');
  expect(adapter.valid({ ...attempt, locale: 'en' })).toBe(false);
  expect((await adapter.send({ ...attempt, locale: 'en' }, material)).status).toBe('FAILED');
  expect(fake.calls).toBe(0);
});
