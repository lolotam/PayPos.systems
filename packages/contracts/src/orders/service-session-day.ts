import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { pageQuery } from '../pagination/cursor.js';
import { sessionMoney } from './service-session.js';

const id = sharedId.toLowerCase();
// PostgreSQL لا يقبل السنة صفر؛ الرفض هنا يعيد خطأ تحقق بدلاً من خطأ قاعدة البيانات.
const date = z.iso.date().regex(/^(?!0000-)/);
export const serviceSessionDayQuery = pageQuery.extend({
  date,
  late: z.literal('true').optional(),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict().meta({ id: 'ServiceSessionDayQuery' });
export const serviceSessionDayCursor = z.strictObject({
  v: z.literal(1), company: id, business: id, branch: id, date, late: z.boolean(),
  at: timestamp.regex(/^(?!0000-)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), id,
});
const names = { name_ar: z.string().nullable(), name_en: z.string() };
export const serviceSessionDayPerformer = responseObject({
  employee_id: id, ...names, share_bps: z.number().int().min(1).max(10000),
  not_clocked_in_warning: z.boolean(), approved_leave_warning: z.boolean(),
}).meta({ id: 'ServiceSessionDayPerformer' });
export const serviceSessionDayLine = responseObject({
  id, service_id: id, ordinal: z.number().int().min(1).max(20), ...names,
  status: z.enum(['ACTIVE', 'CANCELLED']), revision: z.number().int().positive(),
  // مشتق من وجود صف service_line_edits للسطر، ولا يُستنتج من revision.
  edited: z.boolean(),
  list_price: sessionMoney, price: sessionMoney, discount: sessionMoney, net: sessionMoney,
  effective_discount_bps: z.number().int().min(0).max(10000), recorded_by: id,
  recorded_at: timestamp, late: z.boolean(), has_performer_warning: z.boolean(),
  performers: z.array(serviceSessionDayPerformer).min(1).max(4),
}).meta({ id: 'ServiceSessionDayLine' });
export const serviceSessionDayItem = responseObject({
  id, business_id: id, branch_id: id, customer: responseObject({ id, name: z.string() }),
  occurred_at: timestamp, recorded_at: timestamp, business_date: date,
  business_timezone: z.string(), recorded_by: id, late: z.boolean(),
  lines: z.array(serviceSessionDayLine).min(1).max(20),
}).meta({ id: 'ServiceSessionDayItem' });
export const serviceSessionDayPage = responseObject({
  items: z.array(serviceSessionDayItem).max(100), next_cursor: z.string().max(512).nullable(),
}).meta({ id: 'ServiceSessionDayPage' });
export const serviceSessionDaySchemas = [serviceSessionDayQuery, serviceSessionDayPerformer,
  serviceSessionDayLine, serviceSessionDayItem, serviceSessionDayPage];
export type ServiceSessionDayQuery = z.infer<typeof serviceSessionDayQuery>;
export type ServiceSessionDayCursor = z.infer<typeof serviceSessionDayCursor>;
export type ServiceSessionDayPage = z.infer<typeof serviceSessionDayPage>;
