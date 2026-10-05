import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// كود الكارت شبه سرّي: طول محدود ومجموعة طباعة أحادية فقط، وتقليم طرفي واحد في العقد والتطبيع.
export const employeeCardCode = z
  .string()
  .trim()
  .min(4)
  .max(64)
  .regex(/^[\x21-\x7e]+$/);
export const issueEmployeeCardInput = z
  .strictObject({ card_code: employeeCardCode })
  .meta({ id: 'IssueEmployeeCardInput' });
// لا يُعاد الكود الكامل؛ اللاحقة وحدها تكفي لتأكيد الكارت في الواجهة.
export const employeeCard = z
  .strictObject({
    id,
    employee_id: id,
    card_code_suffix: z.string().max(4),
    issued_at: timestamp,
    revoked_at: timestamp.nullable(),
  })
  .meta({ id: 'EmployeeCard' });
export const employeeCardsView = z
  .strictObject({
    active: employeeCard.nullable(),
    can_manage: z.boolean(),
  })
  .meta({ id: 'EmployeeCardsView' });
export const employeeCardSchemas = [
  issueEmployeeCardInput,
  employeeCard,
  employeeCardsView,
];
export type IssueEmployeeCardInput = z.infer<typeof issueEmployeeCardInput>;
export type EmployeeCard = z.infer<typeof employeeCard>;
export type EmployeeCardsView = z.infer<typeof employeeCardsView>;
