import { z } from 'zod';
import { nameAr, nameEn } from '../bilingual/names.js';
import { page } from '../pagination/cursor.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

export const setEmployeeNumberInput = z
  .strictObject({ employee_number: z.number().int().min(1).max(999999) })
  .meta({ id: 'SetEmployeeNumberInput' });

export const employeeNumberView = responseObject({
  employee_id: id,
  employee_number: z.number().int().min(1).max(999999),
}).meta({ id: 'EmployeeNumberView' });

const listedNumber = z.number().int().min(1).max(999999).nullable();
export const employeeNumberListItem = responseObject({
  employee_id: id,
  name_ar: nameAr.nullable(),
  name_en: nameEn,
  business_id: id,
  business_name_ar: nameAr.nullable(),
  business_name_en: nameEn,
  employee_number: listedNumber,
}).meta({ id: 'EmployeeNumberListItem' });
export const employeeNumberPage = page(employeeNumberListItem).meta({ id: 'EmployeeNumberPage' });
export const employeeNumberListQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    q: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !value.includes('\u0000'))
      .optional(),
  })
  .meta({ id: 'EmployeeNumberListQuery' });

export type SetEmployeeNumberInput = z.infer<typeof setEmployeeNumberInput>;
export type EmployeeNumberView = z.infer<typeof employeeNumberView>;
export type EmployeeNumberListItem = z.infer<typeof employeeNumberListItem>;
export type EmployeeNumberPage = z.infer<typeof employeeNumberPage>;
export type EmployeeNumberListQuery = z.infer<typeof employeeNumberListQuery>;
