import { z } from 'zod';
import { id } from '../scalars/id.js';

// PostgreSQL لا يملك سنة صفر؛ نفس القيد يشمل تاريخ الكتابة ومؤشر القراءة.
const salaryDate = z.iso.date().regex(/^(?!0000)/);
export const salaryAmount = z.string().regex(/^(0|[1-9]\d{0,10})\.\d{3}$/);
export const setSalaryInput = z
  .strictObject({
    effective_from: salaryDate,
    amount: salaryAmount,
    reason: z.string().trim().min(1).max(500),
  })
  .meta({ id: 'SetSalaryInput' });
export const employeeSalary = z
  .strictObject({
    id,
    employee_id: id,
    effective_from: salaryDate,
    amount: salaryAmount,
    set_by: id,
    revision: z.number().int().positive(),
    reason: z.string(),
  })
  .meta({ id: 'EmployeeSalary' });
export const salaryHistoryQuery = z
  .object({
    cursor: salaryDate.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'SalaryHistoryQuery' });
export const salaryHistoryPage = z
  .object({
    items: z.array(employeeSalary),
    next_cursor: salaryDate.nullable(),
    can_manage: z.boolean(),
  })
  .meta({ id: 'SalaryHistoryPage' });
export type SetSalaryInput = z.infer<typeof setSalaryInput>;
export type EmployeeSalary = z.infer<typeof employeeSalary>;
export type SalaryHistoryQuery = z.infer<typeof salaryHistoryQuery>;
export type SalaryHistoryPage = z.infer<typeof salaryHistoryPage>;
