import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { passkeyBindingStatus } from './passkeys.js';
import {
  attendanceDeviceRefusal,
  attendanceDeviceRefusalPage,
} from './attendance-device-refusals.js';

export const unbindPasskeyInput = z
  .strictObject({
    binding_id: id.toLowerCase(),
    revision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .meta({ id: 'UnbindPasskeyInput' });
export const unboundPasskey = z
  .strictObject({
    binding_id: id,
    revision: z.number().int().positive(),
    unbound_at: timestamp,
  })
  .meta({ id: 'UnboundPasskey' });
export const passkeyHistoryQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'PasskeyHistoryQuery' });
export const passkeyHistoryEntry = z
  .strictObject({
    binding_id: id,
    revision: z.number().int().positive(),
    bound_at: timestamp,
    unbound_at: timestamp.nullable(),
  })
  .meta({ id: 'PasskeyHistoryEntry' });
export const employeePasskeyHistory = z
  .strictObject({
    status: passkeyBindingStatus.extend({
      phone_locked: z.boolean(),
      phone_locked_since: timestamp.nullable(),
    }),
    can_unbind: z.boolean(),
    items: z.array(passkeyHistoryEntry),
    next_cursor: id.nullable(),
  })
  .meta({ id: 'EmployeePasskeyHistory' });
export const passkeyEmployee = z
  .strictObject({
    id,
    name_en: z.string(),
    name_ar: z.string().nullable(),
    primary_branch_id: id,
  })
  .meta({ id: 'PasskeyEmployee' });
export const passkeyEmployeePage = z
  .strictObject({
    items: z.array(passkeyEmployee),
    next_cursor: id.nullable(),
  })
  .meta({ id: 'PasskeyEmployeePage' });

// معرف عشوائي لتثبيت التطبيق فقط؛ لا يحمل ادعاء بصمة هاتف أو إذن حضور.
export const attendanceInstallationSignal = z
  .strictObject({
    installation_id: z.uuid({ version: 'v4' }).toLowerCase(),
  })
  .meta({ id: 'AttendanceInstallationSignal' });
export type UnbindPasskeyInput = z.infer<typeof unbindPasskeyInput>;
export type UnboundPasskey = z.infer<typeof unboundPasskey>;
export type PasskeyHistoryQuery = z.infer<typeof passkeyHistoryQuery>;
export type EmployeePasskeyHistory = z.infer<typeof employeePasskeyHistory>;
export type PasskeyEmployeePage = z.infer<typeof passkeyEmployeePage>;
export type AttendanceInstallationSignal = z.infer<typeof attendanceInstallationSignal>;
export const unbindPasskeySchemas = [
  attendanceDeviceRefusal,
  attendanceDeviceRefusalPage,
  unbindPasskeyInput,
  unboundPasskey,
  passkeyHistoryQuery,
  passkeyHistoryEntry,
  employeePasskeyHistory,
  passkeyEmployee,
  passkeyEmployeePage,
  attendanceInstallationSignal,
];
