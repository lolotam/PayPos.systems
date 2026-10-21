import { z } from 'zod';
import { discountApprovalRequestedRecipient, discountApprovedByPerformerRecipient } from '../in-app-notifications.js';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const id = sharedId.toLowerCase();
const serviceName = z.strictObject({ service_id: id, name_en: z.string().min(1).max(255), name_ar: z.string().min(1).max(255).nullable() });

/**
 * حدث واحد لكل طلب محفوظ، في معاملة الطلب نفسها؛ يحمل أسماء الخدمات من لقطات الطلب حتى لا يقرأ مستهلك الجرس الكتالوج.
 * لا اسم عميل ولا هاتف ولا شروط الخصم: الجرس يعرض الفرع والخدمة وأعلى نسبة وعدد السطور فقط (FR-024).
 */
export const discountApprovalRequested = z.strictObject({
  schema_version: z.literal(1),
  request_id: id,
  business_id: id,
  branch_id: id,
  requested_by: id,
  line_count: z.number().int().min(1).max(20),
  max_effective_bps: z.number().int().min(1).max(10000),
  // مميّزة بـ service_id وبترتيب أول ظهور في سطور الطلب.
  services: z.array(serviceName).min(1).max(20),
  occurred_at: timestamp,
}).refine((event) =>
  event.services.length <= event.line_count
  && new Set(event.services.map((service) => service.service_id)).size === event.services.length,
).meta({ id: 'DiscountApprovalRequested' });
export type DiscountApprovalRequested = z.infer<typeof discountApprovalRequested>;

/**
 * حدث مستقل لأن notifications لا تعرف المستلمين؛ عامل orders يلحقه بعد حجز دفتر الطلب (request_id)، مجموعة ≤ 100.
 * المستلمون كل من يملك approve:discounts:branch فعليًا على الفرع ما عدا الطالبة (PP-15.2)، لا قاعدة المديرين في ADR-0037.
 */
export const discountApprovalNoticeRequested = z.strictObject({
  schema_version: z.literal(1),
  request_id: id,
  business_id: id,
  branch_id: id,
  notification_recipients: z
    .array(discountApprovalRequestedRecipient.extend({ locale: z.literal('ar') }))
    .min(1)
    .max(100),
}).meta({ id: 'DiscountApprovalNoticeRequested' });
export type DiscountApprovalNoticeRequested = z.infer<typeof discountApprovalNoticeRequested>;

/**
 * DA-Q3 (وليد، 2026-10-21): حدث واحد لكل قرار موافقة يكون الموافِق فيه مرتبطًا بمنفّذ في شروط مقترح واحد على الأقل
 * (لقطة وقت الطلب ∪ الربط الحالي)، في معاملة القرار نفسها؛ proposals هي هذه المقترحات فقط. الرفض لا يُصدره.
 */
export const discountApprovedByPerformer = z.strictObject({
  schema_version: z.literal(1),
  business_id: id,
  branch_id: id,
  approved_by: id,
  approved_by_membership_id: id,
  decided_via: z.enum(['PIN', 'REMOTE']),
  decided_at: timestamp,
  proposals: z.array(z.strictObject({
    proposal_id: id, request_id: id, ...serviceName.shape, effective_bps: z.number().int().min(1).max(10000),
  })).min(1).max(20),
}).refine((event) => new Set(event.proposals.map((proposal) => proposal.proposal_id)).size === event.proposals.length)
  .meta({ id: 'DiscountApprovedByPerformer' });
export type DiscountApprovedByPerformer = z.infer<typeof discountApprovedByPerformer>;

/** جرس المالك (DA-Q3) في مجموعات ≤ 100؛ المستلمون الملاك النشطون — TODO(spec) DA-Q3: نطاق «المالك» يُثبَّت في تحديث المواصفة. */
export const discountApprovedByPerformerNoticeRequested = z.strictObject({
  schema_version: z.literal(1),
  business_id: id,
  branch_id: id,
  proposal_ids: z.array(id).min(1).max(20),
  notification_recipients: z
    .array(discountApprovedByPerformerRecipient.extend({ locale: z.literal('ar') }))
    .min(1)
    .max(100),
}).meta({ id: 'DiscountApprovedByPerformerNoticeRequested' });
export type DiscountApprovedByPerformerNoticeRequested = z.infer<typeof discountApprovedByPerformerNoticeRequested>;

export const discountApprovalEventSchemas = [discountApprovalRequested, discountApprovalNoticeRequested,
  discountApprovedByPerformer, discountApprovedByPerformerNoticeRequested];
