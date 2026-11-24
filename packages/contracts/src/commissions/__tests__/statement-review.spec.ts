import { expect, it } from 'vitest';

import {
  commissionStatementAwaitingApprovalRequested,
  commissionStatementNoticeGroupSize,
} from '../statement-awaiting-approval.js';
import {
  commissionStatementReturnInput,
  commissionStatementReturnResult,
  commissionStatementReviewInput,
  commissionStatementReviewResult,
} from '../statement-review.js';

const FINGERPRINT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

it('the review request carries the two fingerprints the reviewer saw', () => {
  const parsed = commissionStatementReviewInput.parse({
    expected_fingerprint: FINGERPRINT,
    expected_statement_fingerprint: OTHER,
  });
  expect(parsed.expected_fingerprint).toBe(FINGERPRINT);
  expect(parsed.expected_statement_fingerprint).toBe(OTHER);
});

it('the review request refuses a fingerprint that is not a lowercase sha-256 hex', () => {
  expect(
    commissionStatementReviewInput.safeParse({
      expected_fingerprint: FINGERPRINT.toUpperCase(),
      expected_statement_fingerprint: OTHER,
    }).success,
  ).toBe(false);
  expect(
    commissionStatementReviewInput.safeParse({
      expected_fingerprint: 'short',
      expected_statement_fingerprint: OTHER,
    }).success,
  ).toBe(false);
});

it('the return request carries the reason unbounded; the rule lives in the api domain', () => {
  // بلا حدّ شكلي ولا قصّ في العقد (نفس قاعدة سبب رفض الخصم): السبب الفارغ بعد القص أو الأطول من
  // 500 حرف لازم يوصل النطاق فيرد 422 COMMISSION_RETURN_REASON_INVALID لا 400.
  expect(commissionStatementReturnInput.parse({ reason: '  سبب  ' }).reason).toBe('  سبب  ');
  expect(commissionStatementReturnInput.safeParse({ reason: '' }).success).toBe(true);
  expect(commissionStatementReturnInput.safeParse({ reason: 'x'.repeat(501) }).success).toBe(true);
  expect(commissionStatementReturnInput.safeParse({ reason: 5 }).success).toBe(false);
});

it('the review result names the reviewed status and both reviewed fingerprints', () => {
  expect(
    commissionStatementReviewResult.parse({
      status: 'REVIEWED',
      reviewed_fingerprint: FINGERPRINT,
      reviewed_statement_fingerprint: OTHER,
    }),
  ).toEqual({
    status: 'REVIEWED',
    reviewed_fingerprint: FINGERPRINT,
    reviewed_statement_fingerprint: OTHER,
  });
  expect(commissionStatementReturnResult.parse({ status: 'DRAFT' })).toEqual({ status: 'DRAFT' });
});

it('the approval notice carries the period and the recipients, and never more than a hundred', () => {
  const recipients = Array.from({ length: 3 }, (_, index) => ({
    channel: 'IN_APP',
    user_id: `01920000-0000-7000-8000-00000000000${index}`,
    locale: 'ar',
    template_key: 'statement_awaiting_approval',
    template_revision: 1,
    safe_parameters: [{ name: 'period', type: 'text', value: '2026-11' }],
  }));
  const payload = commissionStatementAwaitingApprovalRequested.parse({
    schema_version: 1,
    business_id: '01920000-0000-7000-8000-000000000001',
    statement_id: '01920000-0000-7000-8000-000000000002',
    period: '2026-11',
    group_index: 0,
    notification_recipients: recipients,
  });
  expect(payload.notification_recipients).toHaveLength(3);
  expect(commissionStatementNoticeGroupSize).toBe(100);
  // مية معرّف سليم مميز: آخر أربعة خانات hex للمجموعة الأخيرة، فعلى 101 المفهرس ما يكسّرش شكل UUID.
  const uuidAt = (index: number): string =>
    `01920000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
  expect(
    commissionStatementAwaitingApprovalRequested.safeParse({
      ...payload,
      notification_recipients: Array.from({ length: 101 }, (_, index) => ({
        ...recipients[0],
        user_id: uuidAt(index),
      })),
    }).success,
  ).toBe(false);
});
