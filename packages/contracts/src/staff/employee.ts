import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { nameAr, nameEn } from '../bilingual/names.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// قرار المالك 2026-10-03: الأدوار البشرية فقط؛ Device اعتماد جهاز وليس موظفاً.
export const employeeRoleCode = z
  .enum([
    'owner',
    'general_manager',
    'accountant',
    'business_manager',
    'branch_manager',
    'shift_supervisor',
    'cashier',
    'waiter',
    'kitchen',
    'storekeeper',
    'staff',
    'marketing',
    'viewer',
  ])
  .meta({ id: 'EmployeeRoleCode' });
export const employeeDate = z.iso.date().meta({ id: 'EmployeeDate' });
// Postgres يعيد UUID بحروف صغيرة والمقارنات بعدها نصية؛ توحيد المدخل يمنع رفض فرع صحيح كُتب بحروف كبيرة.
export const employeeInputId = id.toLowerCase();
export const createEmployeeInput = z
  .strictObject({
    primary_branch_id: employeeInputId,
    name_en: nameEn,
    name_ar: nameAr.nullable().optional(),
    role_code: employeeRoleCode,
    hire_date: employeeDate,
    contract_end: employeeDate.nullable().optional(),
    user_id: employeeInputId.nullable().optional(),
    // غيابه يبقي الإسناد التلقائي؛ null مرفوض حتى لا يُفهم كمسح للرقم (FR-006).
    employee_number: z.number().int().min(1).max(999999).optional(),
  })
  .meta({ id: 'CreateEmployeeInput' });
// الرقم أرقام صحيحة بلا فواصل (D-2). بعد 8c-11 كل موظف له رقم والغياب مرفوض.
const employeeNumber = z.number().int().min(1).max(999999);
export const employee = responseObject({
    id,
    business_id: id,
    primary_branch_id: id,
    name_en: nameEn,
    name_ar: nameAr.nullable(),
    role_code: employeeRoleCode,
    hire_date: employeeDate,
    contract_end: employeeDate.nullable(),
    user_id: id.nullable(),
    created_at: timestamp,
    employee_number: employeeNumber,
  })
  .meta({ id: 'Employee' });
// نفس تعريف الرقم على الموظف الموسّع حتى يبقى مخطط CreatedEmployee المنشور منفصلاً عن Employee.
export const createdEmployee = employee
  .extend({ employee_number: employeeNumber })
  .meta({ id: 'CreatedEmployee' });
export type CreateEmployeeInput = z.infer<typeof createEmployeeInput>;
export type Employee = z.infer<typeof employee>;
export type CreatedEmployee = z.infer<typeof createdEmployee>;
