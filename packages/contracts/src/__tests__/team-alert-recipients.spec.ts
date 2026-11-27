import { describe, expect, it } from 'vitest';

import { commissionStatementAwaitingApprovalRequested } from '../commissions/statement-awaiting-approval.js';
import { commissionStatementAwaitingReviewRequested } from '../commissions/statement-awaiting-review.js';
import { lowRatingReceived } from '../customers/low-rating-submitted.js';
import { notificationRequest } from '../notifications.js';
import { discountSelfApprovalNoticeRequested } from '../orders/discount-approval-events.js';
import { lateServiceSessionNoticeRequested } from '../orders/late-service-session-notice.js';
import { serviceLineCancelNoticeRequested } from '../orders/service-line-cancel-notice.js';
import { serviceLineEditNoticeRequested } from '../orders/service-line-edit-notice.js';
import { serviceLinePerformersNoticeRequested } from '../orders/service-line-performers-notice.js';
import {
  TEAM_ALERT_TEMPLATE_KEYS,
  teamAlertEmailRecipient,
  teamAlertWhatsappRecipient,
  type TeamAlertTemplateKey,
} from '../team-alert-recipients.js';

// AL-Q6 (صف 62b-1): كل حدث جرس فريق بيقبل مستلم البريد ومستلم الواتساب التشغيليين لقالب نوعه بالظبط، وبدون أي معامل.
const EVENTS: [string, { shape: { notification_recipients: { safeParse: (v: unknown) => { success: boolean } } } }, TeamAlertTemplateKey][] = [
  ['LateServiceSessionNoticeRequested', lateServiceSessionNoticeRequested, 'late_service_session'],
  ['ServiceLineEditNoticeRequested', serviceLineEditNoticeRequested, 'service_line_price_edited'],
  ['ServiceLineCancelNoticeRequested', serviceLineCancelNoticeRequested, 'service_line_cancelled'],
  ['ServiceLinePerformersNoticeRequested', serviceLinePerformersNoticeRequested, 'service_line_performers_changed'],
  ['DiscountSelfApprovalNoticeRequested', discountSelfApprovalNoticeRequested, 'discount_self_approved'],
  ['CommissionStatementAwaitingReviewRequested', commissionStatementAwaitingReviewRequested, 'statement_awaiting_review'],
  ['CommissionStatementAwaitingApprovalRequested', commissionStatementAwaitingApprovalRequested, 'statement_awaiting_approval'],
  ['LowRatingReceived', lowRatingReceived, 'low_rating'],
];
const email = (key: string, patch: Record<string, unknown> = {}) => ({
  email: 'someone@example.test',
  locale: 'ar',
  channel: 'email',
  template_key: key,
  template_revision: 1,
  safe_parameters: [],
  ...patch,
});
const whatsapp = (key: string, patch: Record<string, unknown> = {}) => ({
  phone: '+999999620001',
  locale: 'ar',
  channel: 'whatsapp',
  template_key: key,
  template_revision: 1,
  safe_parameters: [],
  ...patch,
});

describe.each(EVENTS)('%s recipients', (_name, schema, key) => {
  const accepts = (recipients: unknown[]) =>
    schema.shape.notification_recipients.safeParse(recipients).success;

  it('accepts the strict operational email and WhatsApp recipients of its own template', () => {
    expect(accepts([email(key)])).toBe(true);
    expect(accepts([whatsapp(key)])).toBe(true);
    expect(accepts([email(key), whatsapp(key)])).toBe(true);
  });

  it('refuses another event template, a parameter, a user id, another locale or revision', () => {
    const other = key === 'late_service_session' ? 'low_rating' : 'late_service_session';
    for (const make of [email, whatsapp]) {
      expect(accepts([make(other)])).toBe(false);
      expect(accepts([make(key, { safe_parameters: [{ name: 'a', type: 'text', value: 'b' }] })])).toBe(false);
      expect(accepts([make(key, { user_id: '01920000-0000-7000-8000-000000004005' })])).toBe(false);
      expect(accepts([make(key, { locale: 'en' })])).toBe(false);
      expect(accepts([make(key, { template_revision: 2 })])).toBe(false);
    }
  });

  it('is accepted by the generic notification request the consumer parses', () => {
    const request = { notification_recipients: [email(key), whatsapp(key)] };
    expect(notificationRequest.safeParse(request).success).toBe(true);
  });
});

describe('the low-rating event', () => {
  it('never carries the comment template over email or WhatsApp (RT-Q9)', () => {
    const accepts = (recipients: unknown[]) =>
      lowRatingReceived.shape.notification_recipients.safeParse(recipients).success;
    expect(accepts([email('low_rating_with_comment')])).toBe(false);
    expect(accepts([whatsapp('low_rating_with_comment')])).toBe(false);
  });
});

describe('the recipient builders', () => {
  it('cover the fifteen operational keys and nothing else', () => {
    expect(TEAM_ALERT_TEMPLATE_KEYS).toHaveLength(15);
    expect(TEAM_ALERT_TEMPLATE_KEYS).not.toContain('shift_ends_soon');
    for (const key of TEAM_ALERT_TEMPLATE_KEYS) {
      expect(teamAlertEmailRecipient(key).safeParse(email(key)).success).toBe(true);
      expect(teamAlertWhatsappRecipient(key).safeParse(whatsapp(key)).success).toBe(true);
    }
  });

  it('refuse an unknown field and an empty address or phone', () => {
    expect(teamAlertEmailRecipient('low_rating').safeParse(email('low_rating', { extra: 1 })).success).toBe(false);
    expect(teamAlertEmailRecipient('low_rating').safeParse(email('low_rating', { email: '' })).success).toBe(false);
    expect(teamAlertWhatsappRecipient('low_rating').safeParse(whatsapp('low_rating', { phone: '' })).success).toBe(false);
  });
});
