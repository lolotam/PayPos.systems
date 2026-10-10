import { sql } from 'drizzle-orm';
import { effectiveMaxShiftsPerDay, templateMaxShiftsPerDay } from '../domain/schedule-settings.ts';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { ScheduleError } from '../domain/schedule-types.ts';
import type { ScheduleScope, ScheduleTransactions } from '../ports/schedules.port.ts';
import { schedulingAccess, schedulingContext } from './schedule-context.adapter.ts';
import { scheduleBatchTargets } from './schedule-batch-records.ts';
import { saveScheduleBatch } from './schedule-batch-writes.ts';
import {
  lockedSchedulingEmployee,
  lockedTemplate,
  otherEmployeeShifts,
  scheduleRecord,
} from './schedule-records.ts';
import {
  saveScheduleWeek,
  saveShiftTemplate,
  schedulePersistenceError,
} from './schedule-writes.ts';

async function assertScope(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string | null,
  action: 'read' | 'manage',
  lock: boolean,
) {
  const context = await schedulingContext(tx, companyId, businessId, branchId);
  if (!context) throw new ScheduleError('NOT_FOUND');
  const decision = await schedulingAccess(
    tx,
    companyId,
    userId,
    businessId,
    branchId,
    action,
    lock,
  );
  if (decision === 'DENIED') throw new ScheduleError('NOT_FOUND');
  if (decision === 'FEATURE_DISABLED') throw new ScheduleError('FEATURE_DISABLED');
  // وقت الانتظار على القفل قد يتزامن مع تعديل إعدادات المنطقة؛ نعيد حل السياق بعده.
  const current = lock ? await schedulingContext(tx, companyId, businessId, branchId) : context;
  if (!current) throw new ScheduleError('NOT_FOUND');
  return current;
}
function transactionScope(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
): ScheduleScope {
  let locked = false;
  const access = async (businessId: string, branchId: string | null, action: 'read' | 'manage') => {
    const result = await assertScope(tx, companyId, userId, businessId, branchId, action, !locked);
    locked = true;
    return result;
  };
  return {
    maxShiftsPerDay: (businessId, branchId) => branchLimit(tx, companyId, businessId, branchId),
    templateMaxShiftsPerDay: (businessId) => templateLimit(tx, companyId, businessId),
    branch: (businessId, branchId) => access(businessId, branchId, 'manage'),
    business: async (businessId, action) => {
      await access(businessId, null, action);
    },
    employeeWeek: async (businessId, branchId, employeeId, weekStart) => {
      const employee = await lockedSchedulingEmployee(tx, companyId, businessId, employeeId);
      const before = await scheduleRecord(
        tx,
        companyId,
        businessId,
        branchId,
        employeeId,
        weekStart,
      );
      const others = await otherEmployeeShifts(tx, companyId, employeeId, before);
      return { employee, before, others };
    },
    employeeWeeks: (businessId, branchId, employeeIds, weeks) =>
      scheduleBatchTargets(tx, companyId, businessId, branchId, employeeIds, weeks),
    saveWeek: (before, after, reason) =>
      saveScheduleWeek(tx, companyId, ids, before, after, reason),
    saveWeeks: (plans, reason) => saveScheduleBatch(tx, companyId, ids, plans, reason),
    template: (businessId, templateId) => lockedTemplate(tx, companyId, businessId, templateId),
    saveTemplate: (before, after) => saveShiftTemplate(tx, companyId, ids, before, after),
  };
}
async function branchLimit(tx: Tx, companyId: string, businessId: string, branchId: string) {
  const [row] = await tx.execute<{ max_shifts_per_day: number }>(sql`SELECT COALESCE(
    (SELECT max_shifts_per_day FROM staff_branch_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId} AND branch_id=${branchId}),
    (SELECT max_shifts_per_day FROM staff_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId}),3) AS max_shifts_per_day`);
  if (!row) throw new Error('SCHEDULE_SETTINGS_QUERY_FAILED');
  return row.max_shifts_per_day;
}
async function templateLimit(tx: Tx, companyId: string, businessId: string) {
  const context = await schedulingContext(tx, companyId, businessId, null);
  const [row] = await tx.execute<{
    business_value: number | null;
    branch_values: Record<string, number>;
  }>(sql`SELECT
    (SELECT max_shifts_per_day FROM staff_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId}) AS business_value,
    COALESCE((SELECT jsonb_object_agg(branch_id,max_shifts_per_day) FROM staff_branch_schedule_settings
      WHERE company_id=${companyId} AND business_id=${businessId}),'{}'::jsonb) AS branch_values`);
  if (!row) throw new Error('SCHEDULE_SETTINGS_QUERY_FAILED');
  return templateMaxShiftsPerDay(
    (context?.branchIds ?? []).map((id) =>
      effectiveMaxShiftsPerDay(row.branch_values[id] ?? null, row.business_value),
    ),
    row.business_value,
  );
}
export function createScheduleTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): ScheduleTransactions {
  return {
    run: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) => work(transactionScope(tx, companyId, userId, ids)),
          { userId },
        );
      } catch (error) {
        schedulePersistenceError(error);
      }
    },
  };
}
