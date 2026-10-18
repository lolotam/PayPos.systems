import { z } from 'zod';

import { id } from '../scalars/id.js';
import { page } from '../pagination/cursor.js';
import { createEmployeeInput, employee, employeeDate, employeeInputId } from './employee.js';

const revision = z.number().int().min(1).max(2_147_483_646);
const branches = z
  .array(employeeInputId)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length);
export const updateEmployeeInput = createEmployeeInput
  .extend({
    expected_revision: revision,
    branch_ids: branches,
    branch_effective_date: employeeDate,
  })
  .meta({ id: 'UpdateEmployeeInput' });
export const employeeDetailRecord = employee
  .extend({ revision: z.number().int().positive(), branch_ids: branches })
  .meta({ id: 'EmployeeDetail' });
export const employeeListItem = employee
  .pick({
    id: true,
    name_ar: true,
    name_en: true,
    role_code: true,
    primary_branch_id: true,
    hire_date: true,
    employee_number: true,
  })
  .meta({ id: 'EmployeeListItem' });
export const employeePage = page(employeeListItem).meta({ id: 'EmployeePage' });
export const employeeListQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    // أرقام فقط قبل التحويل حتى لا يُقبل 0x7 أو 1e3 أو مسافة؛ الأصفار البادئة تُشال (TD-3).
    employee_number: z.string().max(50).regex(/^[0-9]+$/).transform(Number).pipe(z.number().int().min(1).max(999999)).optional(),
    // خانة واحدة: القص يمنع فراغاً، والطول سقف خانة القائمة (EN-Q16). المحرف الفارغ يرفضه Postgres كنص.
    q: z.string().trim().min(1).max(100).refine((value) => !value.includes('\u0000')).optional(),
  })
  .meta({ id: 'EmployeeListQuery' });
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeInput>;
export type EmployeeDetail = z.infer<typeof employeeDetailRecord>;
export type EmployeeListItem = z.infer<typeof employeeListItem>;
export type EmployeePage = z.infer<typeof employeePage>;
export type EmployeeListQuery = z.infer<typeof employeeListQuery>;
