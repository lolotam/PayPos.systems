import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { packageRefundRecordedRecipient } from '../package-refund-notification.js';
import { sessionMoney } from './service-session.js';

/**
 * حدث استرداد الباقة: عامل orders بيكتبه في نفس معاملة الاسترداد، والعامل بيقراه ليرنّر الجرس.
 * الحدث ما يحملش السبب ولا اسم العميل ولا تليفونه ولا هوية المسترد؛ السبب في سطر الاسترداد المحروس بس.
 */
export const packageRefundRecorded = z
  .strictObject({
    schema_version: z.literal(1),
    refund_id: id,
    entitlement_id: id,
    component_id: id,
    business_id: id,
    branch_id: id,
    sessions: z.number().int().min(1).max(365),
    amount: sessionMoney,
    business_date: z.iso.date(),
    refunded_at: timestamp,
    entitlement_revision: z.number().int().min(2),
  })
  .meta({ id: 'PackageRefundRecorded' });

/**
 * طلب جرس استرداد الباقة: المستلمين اتحسبوا في المعاملة وبتجوا مقسّمين مجموعات لحد مئة.
 * الحقول الآمنة بس: الباقة والفرع والتاريخ والمبلغ، بلا سبب وبلا عميل.
 */
export const packageRefundNoticeRequested = z
  .strictObject({
    schema_version: z.literal(1),
    refund_id: id,
    entitlement_id: id,
    business_id: id,
    branch_id: id,
    business_date: z.iso.date(),
    business_timezone: z.string().min(1).max(255),
    notification_recipients: z
      .array(packageRefundRecordedRecipient.extend({ locale: z.literal('ar') }))
      .min(1)
      .max(100),
  })
  .meta({ id: 'PackageRefundNoticeRequested' });

export type PackageRefundRecorded = z.infer<typeof packageRefundRecorded>;
export type PackageRefundNoticeRequested = z.infer<typeof packageRefundNoticeRequested>;
