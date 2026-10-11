import { z } from 'zod';
import { id } from '../scalars/id.js';
import { scheduleShift } from './schedules.js';
export const setEmployeeDefaultShiftsInput = z.strictObject({ shifts: z.array(scheduleShift).max(7) }).meta({ id: 'SetEmployeeDefaultShiftsInput' });
export const employeeDefaultShifts = z.object({
  employee_id: id,
  can_manage: z.boolean(),
  branches: z.array(z.object({
    branch_id: id,
    linked: z.boolean(),
    shifts: z.array(scheduleShift).max(7),
    updated_at: z.iso.datetime().nullable(),
  })),
}).meta({ id: 'EmployeeDefaultShifts' });
export type SetEmployeeDefaultShiftsInput = z.infer<typeof setEmployeeDefaultShiftsInput>;
export type ScheduleShift = SetEmployeeDefaultShiftsInput['shifts'][number];
export type EmployeeDefaultShifts = z.infer<typeof employeeDefaultShifts>;
export const employeeDefaultShiftsSchemas = [setEmployeeDefaultShiftsInput, employeeDefaultShifts];
