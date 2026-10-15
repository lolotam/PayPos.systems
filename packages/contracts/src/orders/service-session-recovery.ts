import { z } from 'zod';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const id = sharedId.toLowerCase();
// PostgreSQL لا يقبل السنة صفر؛ الرفض هنا يعيد خطأ تحقق بدلاً من خطأ قاعدة البيانات.
const date = z.iso.date().regex(/^(?!0000-)/);
const instant = timestamp.regex(/^(?!0000-)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
export const serviceSessionRecoveryOperation = z.enum([
  'record-service-session', 'append-service-session-lines',
]).meta({ id: 'ServiceSessionRecoveryOperation' });
export const serviceSessionRecoveryQuery = z.strictObject({
  operation: serviceSessionRecoveryOperation,
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).meta({ id: 'ServiceSessionRecoveryQuery' });
export const serviceSessionRecoveryCursor = z.strictObject({
  v: z.literal(1), company: id, business: id, branch: id, operation: serviceSessionRecoveryOperation, proof: id,
  at: instant, id,
});
export const serviceSessionRecoveryLine = z.strictObject({
  id, ordinal: z.number().int().min(1).max(20), name_ar: z.string().nullable(), name_en: z.string(),
}).meta({ id: 'ServiceSessionRecoveryLine' });
export const serviceSessionRecoveryVisit = z.strictObject({
  id, occurred_at: timestamp, customer_name: z.string(), customer_phone_masked: z.string(),
  lines: z.array(serviceSessionRecoveryLine).min(1).max(20),
}).meta({ id: 'ServiceSessionRecoveryVisit' });
export const serviceSessionRecoveryAttempt = z.strictObject({
  business_date: date, business_timezone: z.string(), issued_at: timestamp, expires_at: timestamp,
  outcome: z.enum(['COMMITTED', 'NOT_COMMITTED']).optional(),
}).meta({ id: 'ServiceSessionRecoveryAttempt' });
export const serviceSessionRecoveryPage = z.strictObject({
  items: z.array(serviceSessionRecoveryVisit).max(50), next_cursor: z.string().max(512).nullable(),
  attempt: serviceSessionRecoveryAttempt,
}).meta({ id: 'ServiceSessionRecoveryPage' });
export const confirmSessionRecoveryBody = z.strictObject({
  operation: serviceSessionRecoveryOperation,
  outcome: z.enum(['RECORDED_ELSEWHERE', 'NOT_RECORDED']),
}).meta({ id: 'ConfirmSessionRecoveryBody' });
export const serviceSessionRecoverySchemas = [
  serviceSessionRecoveryOperation, serviceSessionRecoveryQuery, serviceSessionRecoveryLine, serviceSessionRecoveryVisit,
  serviceSessionRecoveryAttempt, serviceSessionRecoveryPage, confirmSessionRecoveryBody,
];
export type ServiceSessionRecoveryOperation = z.infer<typeof serviceSessionRecoveryOperation>;
export type ServiceSessionRecoveryQuery = z.infer<typeof serviceSessionRecoveryQuery>;
export type ServiceSessionRecoveryCursor = z.infer<typeof serviceSessionRecoveryCursor>;
export type ServiceSessionRecoveryVisit = z.infer<typeof serviceSessionRecoveryVisit>;
export type ServiceSessionRecoveryPage = z.infer<typeof serviceSessionRecoveryPage>;
export type ConfirmSessionRecoveryBody = z.infer<typeof confirmSessionRecoveryBody>;
