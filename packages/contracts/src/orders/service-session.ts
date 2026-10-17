import { z } from 'zod';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { lateServiceSessionNoticeRequested } from './late-service-session-notice.js';
import { serviceLineCancelNoticeRequested } from './service-line-cancel-notice.js';
import { serviceLineEditNoticeRequested } from './service-line-edit-notice.js';
import { serviceCommissionRule } from '../catalog/service.js';
const id = sharedId.toLowerCase();

export const sessionMoney = z.string().regex(/^(0|[1-9]\d{0,10})\.\d{3}$/).meta({ id: 'SessionMoney' });
const bps = z.number().int().min(0).max(10000);
const names = { name_en: z.string(), name_ar: z.string().nullable() };
const sessionLineDiscount = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('AMOUNT'), amount: sessionMoney }),
  z.strictObject({ kind: z.literal('PERCENT'), bps }),
]);
export const sessionPerformerInput = z.strictObject({ employee_id: id, share_bps: z.number().optional() })
  .meta({ id: 'SessionPerformerInput' });
export const sessionLineInput = z.strictObject({
  service_id: id,
  price: sessionMoney,
  discount: sessionLineDiscount,
  performers: z.array(sessionPerformerInput),
}).meta({ id: 'SessionLineInput' });
const writeFields = { lines: z.array(sessionLineInput).min(1).max(20), recorder_membership_id: id.optional() };
export const recordServiceSessionInput = z.strictObject({
  customer_id: id, occurred_at: timestamp.optional(), ...writeFields,
}).meta({ id: 'RecordServiceSessionInput' });
export const appendServiceSessionLinesInput = z.strictObject(writeFields).meta({ id: 'AppendServiceSessionLinesInput' });
export const sessionPerformer = z.strictObject({
  id, employee_id: id, performer_ordinal: z.number().int().min(1).max(4), share_bps: bps.min(1), ...names,
  not_clocked_in_warning: z.boolean(), approved_leave_warning: z.boolean(),
}).meta({ id: 'SessionPerformer' });
export const savedServiceLine = z.strictObject({
  id, session_id: id, service_id: id, input_index: z.number().int().min(0).max(19),
  ordinal: z.number().int().min(1).max(20), ...names,
  list_price: sessionMoney, price: sessionMoney, discount: sessionMoney, net: sessionMoney,
  effective_discount_bps: bps, limit_bps_applied: bps.nullable(),
  limit_source: z.enum(['OWNER', 'PERSON', 'BUSINESS', 'NOT_CONFIGURED']),
  status: z.enum(['ACTIVE', 'CANCELLED']), revision: z.number().int().positive(),
  rule_snapshot: serviceCommissionRule, counts_snapshot: z.boolean(), catalog_revision: z.number().int().positive(),
  has_performer_warning: z.boolean(), performers: z.array(sessionPerformer).min(1).max(4),
  recorded_by: id, recorded_by_membership_id: id, recorded_at: timestamp, late: z.boolean(),
  // الغياب يعني «لم يُعدَّل» من غير .default، حتى يُعاد جسم التسجيل القديم بايتاً ببايت.
  edited: z.boolean().optional(),
}).meta({ id: 'SavedServiceLine' });
export const serviceSession = z.strictObject({
  id, business_id: id, branch_id: id, customer: z.strictObject({ id, name: z.string(), phone_masked: z.string() }),
  recorded_by: id, recorded_by_membership_id: id, occurred_at: timestamp, recorded_at: timestamp,
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), business_timezone: z.string(), late: z.boolean(),
  total_net: sessionMoney, lines: z.array(savedServiceLine).min(1).max(20),
}).meta({ id: 'ServiceSession' });
export const rejectedServiceLine = z.strictObject({
  input_index: z.number().int().min(0).max(19), service_id: id, ...names,
  code: z.literal('SESSION_DISCOUNT_ABOVE_LIMIT'), message_ar: z.string(), message_en: z.string(),
  list_price: sessionMoney, price: sessionMoney, discount: sessionMoney, net: sessionMoney,
  effective_discount_bps: bps, limit_bps: bps, limit_source: z.enum(['PERSON', 'BUSINESS', 'NOT_CONFIGURED']),
  minimum_net: sessionMoney, max_discount_amount: sessionMoney,
}).meta({ id: 'RejectedServiceLine' });
const responseFields = { outcome: z.enum(['COMPLETE', 'PARTIAL']), session: serviceSession, rejected_lines: z.array(rejectedServiceLine).max(20) };
export const recordServiceSessionResponse = z.strictObject(responseFields).meta({ id: 'RecordServiceSessionResponse' });
export const appendServiceSessionLinesResponse = z.strictObject({ ...responseFields, added_lines: z.array(savedServiceLine).min(1).max(20) })
  .meta({ id: 'AppendServiceSessionLinesResponse' });
export const editServiceLineInput = z.strictObject({
  price: sessionMoney,
  discount: sessionLineDiscount,
  // السبب الغائب يصل للنطاق ليرد 422، لا 400 من التحقق الشكلي.
  reason: z.string().optional(),
  expected_revision: z.number().int().min(1),
  editor_membership_id: id.optional(),
}).meta({ id: 'EditServiceLineInput' });
const editedServiceLine = savedServiceLine.safeExtend({ edited: z.literal(true) });
export const editServiceLineResponseFull = z.strictObject({
  line: editedServiceLine,
  session: z.strictObject({ id, total_net: sessionMoney }),
}).meta({ id: 'EditServiceLineResponseFull' });
export const editServiceLineResponseNarrow = z.strictObject({
  saved: z.literal(true),
  edited: z.literal(true),
}).meta({ id: 'EditServiceLineResponseNarrow' });
export const editServiceLineResponse = z.union([editServiceLineResponseFull, editServiceLineResponseNarrow])
  .meta({ id: 'EditServiceLineResponse' });
const serviceLineChangeFields = {
  changed_at: timestamp,
  changed_by: id,
  changed_by_membership_id: id,
  previous: z.strictObject({
    revision: z.number().int().positive(),
    price: sessionMoney,
    discount: sessionMoney,
    net: sessionMoney,
  }),
};
const serviceLinePriceEdit = z.strictObject({ kind: z.literal('PRICE_DISCOUNT_EDIT'), ...serviceLineChangeFields });
const serviceLineCancel = z.strictObject({ kind: z.literal('LINE_CANCELLED'), ...serviceLineChangeFields });
const serviceLineChangedObject = z.strictObject({
  line_id: id, session_id: id, service_id: id, branch_id: id, business_id: id, customer_id: id,
  status: z.enum(['ACTIVE', 'CANCELLED']), occurred_at: timestamp, recorded_at: timestamp,
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), late: z.boolean(), recorded_by: id, recorded_by_membership_id: id,
  list_price: sessionMoney, price: sessionMoney, discount: sessionMoney, net: sessionMoney,
  performers: z.array(z.strictObject({ employee_id: id, share_bps: bps.min(1) })).min(1).max(4),
  rule_snapshot: serviceCommissionRule, counts_snapshot: z.boolean(), package: z.null(), revision: z.number().int().positive(),
  change: z.discriminatedUnion('kind', [serviceLinePriceEdit, serviceLineCancel]).optional(),
});
/**
 * التغيير اختياري لأن لقطات التسجيل المنشورة صارمة ومن غير المفتاح.
 * تعديل السعر يبقى ACTIVE بالنسخة التالية؛ والإلغاء يحمل حالة السطر كاملة بحالة CANCELLED والنسخة التالية، حتى لا يُقرأ كتعديل سعر.
 */
export const serviceLineChanged = serviceLineChangedObject
  .refine((line) => {
    if (line.change === undefined) return true;
    if (line.revision !== line.change.previous.revision + 1) return false;
    return line.change.kind === 'LINE_CANCELLED' ? line.status === 'CANCELLED' : line.status === 'ACTIVE';
  })
  .meta({ id: 'ServiceLineChanged' });
/**
 * الحذف قبل التدقيق لأن `z.undefined()` لا يُمثَّل في JSON Schema، و`z.never().optional()` ينشر المفتاح بصيغة `not` التي لا يفهمها OpenAPI 3.0.
 */
export const recordedServiceLine = serviceLineChangedObject
  .omit({ change: true })
  .safeExtend({ status: z.literal('ACTIVE'), revision: z.literal(1) })
  .meta({ id: 'RecordedServiceLine' });
const eventFields = {
  schema_version: z.literal(1), session_id: id, business_id: id, branch_id: id, customer_id: id,
  occurred_at: timestamp, recorded_at: timestamp, business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  business_timezone: z.string(), late: z.boolean(), recorded_by: id, recorded_by_membership_id: id,
  lines: z.array(recordedServiceLine).min(1).max(20),
};
export const serviceSessionRecorded = z.strictObject(eventFields).meta({ id: 'ServiceSessionRecorded' });
export const serviceSessionLinesAdded = z.strictObject(eventFields).meta({ id: 'ServiceSessionLinesAdded' });
export const serviceSessionSchemas = [sessionMoney, sessionPerformerInput, sessionLineInput, recordServiceSessionInput,
  appendServiceSessionLinesInput, sessionPerformer, savedServiceLine, serviceSession, rejectedServiceLine,
  recordServiceSessionResponse, appendServiceSessionLinesResponse, editServiceLineInput, editServiceLineResponseFull,
  editServiceLineResponseNarrow, editServiceLineResponse, serviceLineChanged, recordedServiceLine, serviceSessionRecorded, serviceSessionLinesAdded, lateServiceSessionNoticeRequested, serviceLineEditNoticeRequested, serviceLineCancelNoticeRequested];
export type RecordServiceSessionInput = z.infer<typeof recordServiceSessionInput>;
export type AppendServiceSessionLinesInput = z.infer<typeof appendServiceSessionLinesInput>;
export type RecordServiceSessionResponse = z.infer<typeof recordServiceSessionResponse>;
export type AppendServiceSessionLinesResponse = z.infer<typeof appendServiceSessionLinesResponse>;
export type ServiceSession = z.infer<typeof serviceSession>;
export type SavedServiceLine = z.infer<typeof savedServiceLine>;
export type RejectedServiceLine = z.infer<typeof rejectedServiceLine>;
export type ServiceSessionRecorded = z.infer<typeof serviceSessionRecorded>;
export type ServiceSessionLinesAdded = z.infer<typeof serviceSessionLinesAdded>;
export type ServiceLineChanged = z.infer<typeof serviceLineChanged>;
export type EditServiceLineInput = z.infer<typeof editServiceLineInput>;
export type EditServiceLineResponseFull = z.infer<typeof editServiceLineResponseFull>;
export type EditServiceLineResponseNarrow = z.infer<typeof editServiceLineResponseNarrow>;
export type EditServiceLineResponse = z.infer<typeof editServiceLineResponse>;
