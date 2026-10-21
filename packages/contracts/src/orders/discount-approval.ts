import { z } from 'zod';
import { canonicalStaffPhone } from '../identity/staff-otp.js';
import { responseObject } from '../response-object.js';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { pageQuery } from '../pagination/cursor.js';
import { editServiceLineInput, sessionLineInput, sessionMoney } from './service-session.js';

const id = sharedId.toLowerCase();
const termsHash = z.string().regex(/^[0-9a-f]{64}$/);
const effectiveBps = z.number().int().min(1).max(10000);
const inputIndex = z.number().int().min(0).max(19);
const proposalIds = z.array(id).min(1).max(20);
const termsHashes = z.array(termsHash).min(1).max(20);
const serviceNames = { service_id: id, service_name_en: z.string(), service_name_ar: z.string().nullable() };
const amounts = { list_price: sessionMoney, price: sessionMoney, discount: sessionMoney, net: sessionMoney };
// FR-027 (DA-Q5): التعديل يحمل السطر والنسخة التي يعدّلها وقيمها قبل التعديل، والتسجيل لا يحمل منها شيئًا.
// الحصرية شغالة زي أي رد تاني: تحت POSPAY_STRICT_RESPONSES=1 (اختبارات الـ API) الـ responseObject بيبقى صارم، فالـ RECORD اللي فيه حقل تعديل مرفوض، وفي المتصفح المفتاح الزيادة بيتشال.
// وz.never مش مستعمل: بينشر المفتاح بصيغة `not` اللي OpenAPI 3.0 مش بيفهمها (زي service-session.ts).
const kindRecord = { kind: z.literal('RECORD') };
const kindEdit = {
  kind: z.literal('EDIT'), line_id: id, base_revision: z.number().int().min(1),
  base_price: sessionMoney, base_discount: sessionMoney, base_net: sessionMoney,
};
// EXPIRED مشتق من expires_at والساعة المحقونة ولا يُكتب في الصف أبدًا (D-7).
export const discountProposalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED'])
  .meta({ id: 'DiscountProposalStatus' });

// سطر الطلب هو سطر spec 050 بلا discount_proposal_id: طلب موافقة لا يحمل موافقة سابقة، والمفتاح الزائد 400.
export const discountRequestLineInput = z.strictObject(sessionLineInput.omit({ discount_proposal_id: true }).shape)
  .meta({ id: 'DiscountRequestLineInput' });
/** مع session_id تأتي بيانات الزيارة من الزيارة المحفوظة، فإرسال occurred_at معها رفض شكلي (FR-002). */
export const requestDiscountApprovalInput = z.strictObject({
  customer_id: id,
  session_id: id.optional(),
  occurred_at: timestamp.optional(),
  lines: z.array(discountRequestLineInput).min(1).max(20),
  requester_membership_id: id.optional(),
}).refine((input) => input.session_id === undefined || input.occurred_at === undefined, {
  path: ['occurred_at'],
}).meta({ id: 'RequestDiscountApprovalInput' });
// FR-010 (DA-Q4b): expires_at دايمًا لحظة مش NULL: الطلب بيكتبها requested_at + 24 ساعة
// ومرة واحدة بس، والموافقة والرفض الاتنين بيخلّوها زي ما هي.
export const requestedDiscountProposal = responseObject({
  id, input_index: inputIndex, status: discountProposalStatus, expires_at: timestamp,
  effective_bps: effectiveBps, terms_hash: termsHash,
}).meta({ id: 'RequestedDiscountProposal' });
/** occurred_at هو اللحظة المطبّعة التي بُنيت منها الشروط، فإعادة إرسالها تحفظ نفس يوم العمل (FR-007). */
export const requestDiscountApprovalResponse = responseObject({
  request_id: id, occurred_at: timestamp, proposals: z.array(requestedDiscountProposal).min(1).max(20),
}).meta({ id: 'RequestDiscountApprovalResponse' });

/** FR-025 (DA-Q5): جسم تعديل 35d بلا السبب، لأن السبب لا يحرّك مالًا وليس في الشروط؛ الرد هو رد FR-007. */
export const requestDiscountApprovalEditInput = z.strictObject(
  editServiceLineInput.omit({ reason: true, discount_proposal_id: true }).shape,
).meta({ id: 'RequestDiscountApprovalEditInput' });

export const discountProposalRequestQuery = z.strictObject({ request_id: id })
  .meta({ id: 'DiscountProposalRequestQuery' });
// حقول القرار تظهر بعد القرار فقط، والسبب للرفض فقط، وسطر الاستهلاك بعد الاستهلاك فقط.
const requesterCommon = {
  id, request_id: id, input_index: inputIndex, status: discountProposalStatus,
  session_id: id.nullable(), occurred_at: timestamp, ...serviceNames, ...amounts,
  effective_bps: effectiveBps, expires_at: timestamp, terms_hash: termsHash,
  decided_label_ar: z.string().optional(), decided_label_en: z.string().optional(),
  decided_via: z.enum(['PIN', 'REMOTE']).optional(), decided_at: timestamp.optional(),
  // بلا max: Zod يعد وحدات UTF-16، بينما CHECK القاعدة يعد 500 حرفًا.
  reject_reason: z.string().min(1).optional(), consumed_line_id: id.optional(),
};
export const requesterDiscountProposal = z.discriminatedUnion('kind', [
  responseObject({ ...requesterCommon, ...kindRecord }),
  responseObject({ ...requesterCommon, ...kindEdit }),
]).meta({ id: 'RequesterDiscountProposal' });
export const requesterDiscountProposalList = responseObject({
  items: z.array(requesterDiscountProposal).max(20),
}).meta({ id: 'RequesterDiscountProposalList' });

export const pendingDiscountProposalQuery = pageQuery.extend({
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict().meta({ id: 'PendingDiscountProposalQuery' });
/** المؤشر يحمل (requested_at, id) معًا حتى لا تتكرر أو تُفقد طلبات اللحظة الواحدة بين الصفحات. */
export const pendingDiscountProposalCursor = z.strictObject({
  v: z.literal(1), company: id, business: id, branch: id,
  at: timestamp.regex(/^(?!0000-)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), id,
});
export const discountProposalPerformer = responseObject({
  employee_id: id, first_name_en: z.string(), first_name_ar: z.string().nullable(),
}).meta({ id: 'DiscountProposalPerformer' });
// كل الأسماء لقطات وقت الطلب (D-18): الاسم الأول للعميل فقط، ولا هاتف أبدًا.
const pendingCommon = {
  id, request_id: id, session_id: id.nullable(), occurred_at: timestamp, ...serviceNames, ...amounts,
  effective_bps: effectiveBps, performers: z.array(discountProposalPerformer).min(1).max(4),
  requester_label_ar: z.string(), requester_label_en: z.string(), customer_first_name: z.string(),
  requested_at: timestamp, expires_at: timestamp, terms_hash: termsHash,
};
export const pendingDiscountProposal = z.discriminatedUnion('kind', [
  responseObject({ ...pendingCommon, ...kindRecord }),
  responseObject({ ...pendingCommon, ...kindEdit }),
]).meta({ id: 'PendingDiscountProposal' });
export const pendingDiscountProposalPage = responseObject({
  items: z.array(pendingDiscountProposal).max(100), next_cursor: z.string().max(512).nullable(),
}).meta({ id: 'PendingDiscountProposalPage' });

/** القائمة على جهاز الفرع قبل الرقم السري (DA-Q8): بلا هاتف وبلا مؤدّين، والاسم الأول للطالبة يرجع لاسم الدور عند غيابه. */
const deviceCommon = {
  id, request_id: id, service_name_en: z.string(), service_name_ar: z.string().nullable(), ...amounts,
  effective_bps: effectiveBps, requester_first_name_en: z.string(), requester_first_name_ar: z.string().nullable(),
  customer_first_name: z.string(), requested_at: timestamp, expires_at: timestamp, terms_hash: termsHash,
};
export const deviceDiscountProposal = z.discriminatedUnion('kind', [
  responseObject({ ...deviceCommon, ...kindRecord }),
  responseObject({ ...deviceCommon, ...kindEdit }),
]).meta({ id: 'DeviceDiscountProposal' });
/** جهاز الفرع يقرأ فرعته وحده، فمؤشره بلا business: مسار الجهاز ما فيه business أصلًا. */
export const deviceDiscountProposalQuery = pageQuery.extend({
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict().meta({ id: 'DeviceDiscountProposalQuery' });
export const deviceDiscountProposalCursor = z.strictObject({
  v: z.literal(1), company: id, branch: id,
  at: timestamp.regex(/^(?!0000-)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), id,
});
export const deviceDiscountProposalList = responseObject({
  items: z.array(deviceDiscountProposal).max(100), next_cursor: z.string().max(512).nullable(),
}).meta({ id: 'DeviceDiscountProposalList' });

// البصمات بنفس ترتيب المعرّفات؛ اختلاف العدد أو تكرار معرّف رفض شكلي، واختلاف البصمة المخزّنة 409 من النطاق.
const sameOrder = (input: { proposal_ids: string[]; terms_hashes: string[] }) =>
  input.proposal_ids.length === input.terms_hashes.length
  && new Set(input.proposal_ids).size === input.proposal_ids.length;
const decisionFields = { proposal_ids: proposalIds, terms_hashes: termsHashes, approver_membership_id: id.optional() };
// السبب اختياري (FR-017، D-12)؛ بلا حد شكلي حتى يصل السبب الفارغ بعد القص أو الأطول من 500 للنطاق فيرد 422 DISCOUNT_REJECT_REASON_INVALID لا 400.
const reasonField = { reason: z.string().optional() };
export const approveDiscountProposalsInput = z.strictObject(decisionFields).refine(sameOrder, { path: ['terms_hashes'] })
  .meta({ id: 'ApproveDiscountProposalsInput' });
export const rejectDiscountProposalsInput = z.strictObject({ ...decisionFields, ...reasonField })
  .refine(sameOrder, { path: ['terms_hashes'] }).meta({ id: 'RejectDiscountProposalsInput' });
// الرقم السري يثبت هوية الموافِق لهذا الفعل فقط: لا جلسة، ولا يُخزّن ولا يُسجَّل ولا يُرد (FR-023).
const pinFields = { phone: canonicalStaffPhone, pin: z.string().regex(/^\d{4}$/) };
export const deviceApproveDiscountProposalsInput = z.strictObject({ ...decisionFields, ...pinFields })
  .refine(sameOrder, { path: ['terms_hashes'] }).meta({ id: 'DeviceApproveDiscountProposalsInput' });
export const deviceRejectDiscountProposalsInput = z.strictObject({ ...decisionFields, ...pinFields, ...reasonField })
  .refine(sameOrder, { path: ['terms_hashes'] }).meta({ id: 'DeviceRejectDiscountProposalsInput' });
// FR-018 مع FR-010: القرار بيرجّع الحالة ولحظة الانتهاء، وهي دايمًا موجودة (الرفض بيخلي اللي الطلب كتبها).
export const decidedDiscountProposal = responseObject({
  id, status: z.enum(['APPROVED', 'REJECTED']), expires_at: timestamp,
}).meta({ id: 'DecidedDiscountProposal' });
export const decideDiscountProposalsResponse = responseObject({
  proposals: z.array(decidedDiscountProposal).min(1).max(20),
}).meta({ id: 'DecideDiscountProposalsResponse' });

export const discountApprovalSchemas = [discountProposalStatus, discountRequestLineInput, requestDiscountApprovalInput,
  requestDiscountApprovalEditInput,
  requestedDiscountProposal, requestDiscountApprovalResponse, discountProposalRequestQuery, requesterDiscountProposal,
  requesterDiscountProposalList, pendingDiscountProposalQuery, discountProposalPerformer, pendingDiscountProposal,
  pendingDiscountProposalPage, deviceDiscountProposal, deviceDiscountProposalQuery, deviceDiscountProposalList,
  approveDiscountProposalsInput,
  rejectDiscountProposalsInput, deviceApproveDiscountProposalsInput, deviceRejectDiscountProposalsInput,
  decidedDiscountProposal, decideDiscountProposalsResponse];
export type DiscountProposalStatus = z.infer<typeof discountProposalStatus>;
export type RequestDiscountApprovalInput = z.infer<typeof requestDiscountApprovalInput>;
export type RequestDiscountApprovalEditInput = z.infer<typeof requestDiscountApprovalEditInput>;
export type RequestDiscountApprovalResponse = z.infer<typeof requestDiscountApprovalResponse>;
export type RequesterDiscountProposalList = z.infer<typeof requesterDiscountProposalList>;
export type PendingDiscountProposalQuery = z.infer<typeof pendingDiscountProposalQuery>;
export type PendingDiscountProposalCursor = z.infer<typeof pendingDiscountProposalCursor>;
export type PendingDiscountProposalPage = z.infer<typeof pendingDiscountProposalPage>;
export type DeviceDiscountProposalQuery = z.infer<typeof deviceDiscountProposalQuery>;
export type DeviceDiscountProposalCursor = z.infer<typeof deviceDiscountProposalCursor>;
export type DeviceDiscountProposalList = z.infer<typeof deviceDiscountProposalList>;
export type ApproveDiscountProposalsInput = z.infer<typeof approveDiscountProposalsInput>;
export type RejectDiscountProposalsInput = z.infer<typeof rejectDiscountProposalsInput>;
export type DeviceApproveDiscountProposalsInput = z.infer<typeof deviceApproveDiscountProposalsInput>;
export type DeviceRejectDiscountProposalsInput = z.infer<typeof deviceRejectDiscountProposalsInput>;
export type DecideDiscountProposalsResponse = z.infer<typeof decideDiscountProposalsResponse>;
