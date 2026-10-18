import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { employeeInputId } from './employee.js';

export const setEmployeeNumberInput = z
  .strictObject({ employee_number: z.number().int().min(1).max(999999) })
  .meta({ id: 'SetEmployeeNumberInput' });

export const employeeNumberView = responseObject({
  employee_id: id,
  employee_number: z.number().int().min(1).max(999999),
}).meta({ id: 'EmployeeNumberView' });

export const employeeNumberCapabilityQuery = z
  .strictObject({ primary_branch_id: employeeInputId })
  .meta({ id: 'EmployeeNumberCapabilityQuery' });

export const employeeNumberCapability = responseObject({
  can_type_number: z.boolean(),
}).meta({ id: 'EmployeeNumberCapability' });

export type SetEmployeeNumberInput = z.infer<typeof setEmployeeNumberInput>;
export type EmployeeNumberView = z.infer<typeof employeeNumberView>;
export type EmployeeNumberCapabilityQuery = z.infer<typeof employeeNumberCapabilityQuery>;
export type EmployeeNumberCapability = z.infer<typeof employeeNumberCapability>;
