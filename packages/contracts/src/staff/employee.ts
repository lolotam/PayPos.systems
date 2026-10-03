import { z } from 'zod';

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
export const createEmployeeInput = z
  .strictObject({
    primary_branch_id: id,
    name_en: nameEn,
    name_ar: nameAr.nullable().optional(),
    role_code: employeeRoleCode,
    hire_date: employeeDate,
    contract_end: employeeDate.nullable().optional(),
    user_id: id.nullable().optional(),
  })
  .meta({ id: 'CreateEmployeeInput' });
export const employee = z
  .object({
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
  })
  .meta({ id: 'Employee' });
export type CreateEmployeeInput = z.infer<typeof createEmployeeInput>;
export type Employee = z.infer<typeof employee>;
