import { z } from 'zod';
import { nameAr, nameEn } from '../bilingual/names.js';
import { employee, employeeInputId } from './employee.js';

export const employeeNameMatchesInput = z
  .strictObject({
    name_en: nameEn,
    name_ar: nameAr.nullable().optional(),
    exclude_employee_id: employeeInputId.optional(),
  })
  .meta({ id: 'EmployeeNameMatchesInput' });

export const employeeNameMatch = employee.pick({
  id: true,
  name_en: true,
  name_ar: true,
  primary_branch_id: true,
  role_code: true,
});

export const employeeNameMatches = z
  .object({
    matches: z.array(employeeNameMatch).max(10),
    visible_total: z.number().int().nonnegative(),
    hidden_exists: z.boolean(),
  })
  .meta({ id: 'EmployeeNameMatches' });

export type EmployeeNameMatchesInput = z.infer<typeof employeeNameMatchesInput>;
export type EmployeeNameMatch = z.infer<typeof employeeNameMatch>;
export type EmployeeNameMatches = z.infer<typeof employeeNameMatches>;
