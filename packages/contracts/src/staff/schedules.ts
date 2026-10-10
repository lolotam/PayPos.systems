import { z } from 'zod';
import { scheduleSettings, setScheduleSettingsInput } from './schedule-settings.js';
import { id } from '../scalars/id.js';
import { nameAr, nameEn } from '../bilingual/names.js';
import { employeeDate, employeeInputId } from './employee.js';
import { timeZone } from '../reference/time-zone.js';

export const scheduleShift = z
  .strictObject({
    day: z.number().int().min(0).max(6),
    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  })
  .meta({ id: 'ScheduleShift' });
export const schedulePattern = z.array(scheduleShift).max(28).meta({ id: 'SchedulePattern' });
export const scheduleReason = z.string().trim().min(1).max(500);
export const setScheduleInput = z
  .strictObject({
    week_start: employeeDate,
    expected_revision: z.number().int().min(0).max(2147483646),
    shifts: schedulePattern,
    reason: scheduleReason.optional(),
  })
  .meta({ id: 'SetScheduleInput' });
export const concreteShift = scheduleShift
  .extend({
    working_date: employeeDate,
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
  })
  .meta({ id: 'ConcreteShift' });
export const staffSchedule = z
  .object({
    id,
    business_id: id,
    branch_id: id,
    employee_id: id,
    week_start: employeeDate,
    timezone: timeZone,
    revision: z.number().int().positive(),
    shifts: z.array(concreteShift).max(28),
  })
  .meta({ id: 'StaffSchedule' });
export const scheduleWeekQuery = z
  .strictObject({ week_start: employeeDate })
  .meta({ id: 'ScheduleWeekQuery' });
export const scheduleListQuery = scheduleWeekQuery
  .extend({
    cursor: employeeInputId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'ScheduleListQuery' });
export const scheduleWeekResult = z
  .object({ schedule: staffSchedule.nullable() })
  .meta({ id: 'ScheduleWeekResult' });
export const scheduleGridRow = z
  .object({
    employee_id: id,
    name_en: nameEn,
    name_ar: nameAr.nullable(),
    schedule: staffSchedule.nullable(),
  })
  .meta({ id: 'ScheduleGridRow' });
export const scheduleGrid = z
  .object({
    week_start: employeeDate,
    days: z.array(employeeDate).length(7),
    timezone: timeZone,
    max_shifts_per_day: z.number().int().min(1).max(4),
    items: z.array(scheduleGridRow),
    next_cursor: id.nullable(),
  })
  .meta({ id: 'ScheduleGrid' });
export const templateTerms = z
  .strictObject({ name_en: nameEn, name_ar: nameAr.nullable().optional(), shifts: schedulePattern })
  .meta({ id: 'TemplateTerms' });
export const updateTemplateInput = templateTerms
  .extend({ expected_revision: z.number().int().positive().max(2147483646) })
  .meta({ id: 'UpdateTemplateInput' });
export const archiveTemplateInput = z
  .strictObject({ expected_revision: z.number().int().positive().max(2147483646) })
  .meta({ id: 'ArchiveTemplateInput' });
export const shiftTemplate = z
  .object({
    id,
    business_id: id,
    name_en: nameEn,
    name_ar: nameAr.nullable(),
    shifts: schedulePattern,
    revision: z.number().int().positive(),
    archived_at: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ShiftTemplate' });
export const templatePage = z
  .object({
    items: z.array(shiftTemplate),
    next_cursor: id.nullable(),
    max_shifts_per_day: z.number().int().min(1).max(4),
  })
  .meta({ id: 'TemplatePage' });
export const templateListQuery = z
  .strictObject({
    cursor: employeeInputId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'TemplateListQuery' });
export const applyTemplateInput = z
  .strictObject({
    branch_id: employeeInputId,
    // TODO(spec) SC-Q3: تأكيد حد 20 نسخة موظف وأسبوع؛ الدفعات الأكبر تنتظر مسار worker.
    employee_ids: z
      .array(employeeInputId)
      .min(1)
      .refine((v) => new Set(v).size === v.length),
    weeks: z
      .array(employeeDate)
      .min(1)
      .max(12)
      .refine((v) => new Set(v).size === v.length),
    replace: z.boolean().default(false),
    reason: scheduleReason.optional(),
  })
  .meta({
    id: 'ApplyTemplateInput',
    description:
      'At most 12 weeks and 20 employee-week copies per synchronous application; larger applications require a future worker path.',
  });
export const applyTemplateResult = z
  .object({ schedules: z.array(staffSchedule) })
  .meta({ id: 'ApplyTemplateResult' });
export type SetScheduleInput = z.infer<typeof setScheduleInput>;
export type StaffSchedule = z.infer<typeof staffSchedule>;
export type ScheduleListQuery = z.infer<typeof scheduleListQuery>;
export type ScheduleGrid = z.infer<typeof scheduleGrid>;
export type TemplateTerms = z.infer<typeof templateTerms>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateInput>;
export type ShiftTemplate = z.infer<typeof shiftTemplate>;
export type ApplyTemplateInput = z.infer<typeof applyTemplateInput>;
export const scheduleSchemas = [
  scheduleSettings,
  setScheduleSettingsInput,
  templateListQuery,
  scheduleShift,
  schedulePattern,
  setScheduleInput,
  concreteShift,
  staffSchedule,
  scheduleWeekQuery,
  scheduleListQuery,
  scheduleWeekResult,
  scheduleGridRow,
  scheduleGrid,
  templateTerms,
  updateTemplateInput,
  archiveTemplateInput,
  shiftTemplate,
  templatePage,
  applyTemplateInput,
  applyTemplateResult,
];
