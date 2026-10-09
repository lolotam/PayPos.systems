import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

export const setEmployeeIbanInput = z
  .strictObject({
    iban: z.string().max(64).nullable(),
    bank_id: z.string().max(48).nullable(),
    holder_name_en: z.string().max(200).nullable(),
    reason: z.string().trim().min(1).max(500),
    expected_revision: z.number().int().nonnegative(),
  })
  .refine(
    (input) =>
      [input.iban, input.bank_id, input.holder_name_en].every((v) => v === null) ||
      [input.iban, input.bank_id, input.holder_name_en].every((v) => typeof v === 'string'),
  )
  .meta({ id: 'SetEmployeeIbanInput' });

export const employeeIbanView = z
  .strictObject({
    status: z.enum(['SET', 'NOT_SET']),
    iban_last4: z.string().length(4).nullable(),
    iban: z.string().nullable(),
    bank_id: z.string().nullable(),
    holder_name_en: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    set_at: timestamp.nullable(),
    set_by: id.nullable(),
    can_read_full: z.boolean(),
    can_manage: z.boolean(),
  })
  .meta({ id: 'EmployeeIbanView' });

export const employeeIbanHistoryQuery = z
  .strictObject({
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'EmployeeIbanHistoryQuery' });

export const employeeIbanHistoryEntry = z
  .strictObject({
    revision: z.number().int().positive(),
    iban: z.string().nullable(),
    bank_id: z.string().nullable(),
    holder_name_en: z.string().nullable(),
    cleared: z.boolean(),
    set_at: timestamp,
    set_by: id,
    reason: z.string(),
  })
  .meta({ id: 'EmployeeIbanHistoryEntry' });

export const employeeIbanHistoryPage = z
  .strictObject({
    items: z.array(employeeIbanHistoryEntry),
    next_cursor: z.number().int().positive().nullable(),
  })
  .meta({ id: 'EmployeeIbanHistoryPage' });

export const employeeIbanSchemas = [
  setEmployeeIbanInput,
  employeeIbanView,
  employeeIbanHistoryQuery,
  employeeIbanHistoryEntry,
  employeeIbanHistoryPage,
];
export type SetEmployeeIbanInput = z.infer<typeof setEmployeeIbanInput>;
export type EmployeeIbanView = z.infer<typeof employeeIbanView>;
export type EmployeeIbanHistoryQuery = z.infer<typeof employeeIbanHistoryQuery>;
export type EmployeeIbanHistoryEntry = z.infer<typeof employeeIbanHistoryEntry>;
export type EmployeeIbanHistoryPage = z.infer<typeof employeeIbanHistoryPage>;
