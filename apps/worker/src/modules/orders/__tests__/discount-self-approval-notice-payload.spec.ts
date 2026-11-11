import {
  discountSelfApprovalNoticeRequested,
  type DiscountSelfApprovalNoticeRequested,
} from '@pospay/contracts';
import { safeDisplayName } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { selfApprovalNoticeParameters } from '../domain/discount-self-approval-notice.ts';
import type { DiscountSelfApprovalNoticePayload } from '../ports/discount-self-approval-notice.port.ts';

const parameters = selfApprovalNoticeParameters({
  branch: { nameAr: 'فرع سالم', nameEn: 'Salem' },
  approver: { labelAr: 'مدير سالم', labelEn: 'Salem Manager' },
  service: { nameAr: 'قص', nameEn: 'Cut' },
  maxEffectiveBps: 2000,
  fallback: {
    service: { ar: 'الخدمة', en: 'Service' },
    branch: { ar: 'فرع', en: 'Branch' },
    approver: { ar: 'مستخدم', en: 'User' },
    safeName: safeDisplayName,
  },
});

it('builds a payload assignable to and accepted by the shared notice contract', () => {
  const payload = {
    schema_version: 1,
    business_id: '00000000-0000-4000-8000-000000000001',
    branch_id: '00000000-0000-4000-8000-000000000002',
    proposal_ids: ['00000000-0000-4000-8000-000000000003'],
    notification_recipients: [
      {
        channel: 'IN_APP',
        user_id: '00000000-0000-4000-8000-000000000004',
        locale: 'ar',
        template_key: 'discount_self_approved',
        template_revision: 1,
        safe_parameters: parameters,
      },
    ],
  } satisfies DiscountSelfApprovalNoticePayload;
  const contractPayload: DiscountSelfApprovalNoticeRequested = payload;
  expect(discountSelfApprovalNoticeRequested.parse(contractPayload)).toEqual(contractPayload);
});
