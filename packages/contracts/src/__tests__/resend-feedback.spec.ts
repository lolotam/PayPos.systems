import { describe, expect, it } from 'vitest';
import {
  isStoredResendFeedbackType,
  resendFeedbackEnvelope,
  resendFeedbackType,
} from '../resend-feedback.js';

const body = {
  type: 'email.bounced',
  created_at: '2026-11-23T10:00:00.000Z',
  data: {
    email_id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
    to: ['recipient@example.invalid'],
    from: 'sender@example.invalid',
    subject: 'Your document expires soon',
    template_id: '43f68331-0622-4e15-8202-246a0388854b',
    tags: [{ name: 'company_id', value: '01920000-0000-7000-8000-000000000001' }],
    bounce: {
      type: 'Permanent',
      subType: 'General',
      diagnosticCode: ['smtp; 550 5.5.0 Requested action not taken: mailbox unavailable'],
      message: 'mailbox unavailable',
    },
  },
};

describe('resend feedback contract', () => {
  it('keeps only the allowlisted fields and drops addresses, subject, tags and diagnostics', () => {
    const parsed = resendFeedbackEnvelope.parse(body);
    expect(parsed).toEqual({
      type: 'email.bounced',
      created_at: '2026-11-23T10:00:00.000Z',
      data: {
        email_id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
        bounce: { type: 'Permanent' },
      },
    });
    const stored = JSON.stringify(parsed);
    expect(stored).not.toContain('recipient@example.invalid');
    expect(stored).not.toContain('sender@example.invalid');
    expect(stored).not.toContain('document expires');
    expect(stored).not.toContain('company_id');
    expect(stored).not.toContain('mailbox unavailable');
  });
  it('knows the six stored events; the rest is acknowledged and dropped', () => {
    for (const stored of [
      'email.delivered',
      'email.bounced',
      'email.complained',
      'email.failed',
      'email.suppressed',
      'email.delivery_delayed',
    ])
      expect(isStoredResendFeedbackType(stored)).toBe(true);
    expect(isStoredResendFeedbackType('email.clicked')).toBe(false);
    expect(isStoredResendFeedbackType('email.opened')).toBe(false);
    expect(isStoredResendFeedbackType('email.sent')).toBe(false);
  });
  it('rejects a body without the allowlisted fields', () => {
    expect(resendFeedbackEnvelope.safeParse({ type: 'email.bounced' }).success).toBe(false);
    expect(
      resendFeedbackEnvelope.safeParse({
        type: 'email.bounced',
        created_at: '2026-11-23T10:00:00.000Z',
        data: {},
      }).success,
    ).toBe(false);
    expect(resendFeedbackType.safeParse({ type: 'email.clicked' }).success).toBe(true);
    expect(resendFeedbackType.safeParse({}).success).toBe(false);
  });
});
