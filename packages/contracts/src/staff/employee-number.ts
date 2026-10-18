import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

export const setEmployeeNumberInput = z
  .strictObject({ employee_number: z.number().int().min(1).max(999999) })
  .meta({ id: 'SetEmployeeNumberInput' });

export const employeeNumberView = responseObject({
  employee_id: id,
  employee_number: z.number().int().min(1).max(999999),
}).meta({ id: 'EmployeeNumberView' });

export type SetEmployeeNumberInput = z.infer<typeof setEmployeeNumberInput>;
export type EmployeeNumberView = z.infer<typeof employeeNumberView>;
