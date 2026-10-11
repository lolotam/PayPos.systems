import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import type { WeekdayDefaultShift } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { lockEmployeeHoursAccess, readEmployeeHoursAccess } from '../../identity/index.ts';
import { EmployeeDefaultShiftsError, type DefaultShiftLink } from '../domain/employee-default-shifts.ts';
import type { EmployeeDefaultShiftsTransactions, EmployeeHoursActor } from '../ports/employee-default-shifts.port.ts';
import { createEmployeeDetailAccess } from './employee-detail-access.adapter.ts';
import { schedulingContext } from './schedule-context.adapter.ts';

export function createEmployeeHoursReadAccess() {
  return {
    detail: createEmployeeDetailAccess(),
    manage: (tx: Tx, companyId: string, userId: string, businessId: string, branchIds: readonly string[]) =>
      readEmployeeHoursAccess(tx, companyId, userId, businessId, branchIds),
  };
}

async function authorize(tx: Tx, actor: EmployeeHoursActor, businessId: string) {
  await lockEmployeeHoursAccess(tx, actor.companyId);
  const context = await schedulingContext(tx, actor.companyId, businessId, null);
  if (!context) throw new EmployeeDefaultShiftsError('NOT_FOUND');
  const access = await readEmployeeHoursAccess(tx, actor.companyId, actor.userId, businessId);
  if (!access.manage) throw new EmployeeDefaultShiftsError('FORBIDDEN');
  if (!access.featureEnabled) throw new EmployeeDefaultShiftsError('FEATURE_DISABLED');
}

async function lockEmployee(tx: Tx, actor: EmployeeHoursActor, businessId: string,
  employeeId: string, branchId: string) {
  const [employee] = await tx.execute<{ primary_branch_id: string }>(sql`SELECT primary_branch_id
    FROM employees WHERE company_id=${actor.companyId} AND business_id=${businessId}
      AND id=${employeeId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  const branch = await schedulingContext(tx, actor.companyId, businessId, branchId);
  if (!employee || !branch) throw new EmployeeDefaultShiftsError('NOT_FOUND');
  const links = await tx.execute<DefaultShiftLink & Record<string, unknown>>(sql`SELECT branch_id,
    to_char("from",'YYYY-MM-DD') AS "from", to_char("to",'YYYY-MM-DD') AS "to"
    FROM employee_branches WHERE company_id=${actor.companyId} AND employee_id=${employeeId}`);
  const access = await readEmployeeHoursAccess(tx, actor.companyId, actor.userId, businessId,
    [employee.primary_branch_id, branchId, ...links.filter((link) => link.to === null).map((link) => link.branch_id)]);
  if (!access.manage) throw new EmployeeDefaultShiftsError('FORBIDDEN');
  if (!access.featureEnabled) throw new EmployeeDefaultShiftsError('FEATURE_DISABLED');
  return { links, timezone: branch.timezone };
}

async function current(tx: Tx, companyId: string, employeeId: string, branchId: string) {
  return tx.execute<WeekdayDefaultShift & Record<string, unknown>>(sql`SELECT day,
    left(start::text,5) AS start, left("end"::text,5) AS "end",
    left(break_start::text,5) AS break_start, left(break_end::text,5) AS break_end
    FROM employee_default_shifts WHERE company_id=${companyId} AND employee_id=${employeeId}
      AND branch_id=${branchId} ORDER BY day`);
}

async function replace(tx: Tx, actor: EmployeeHoursActor, ids: IdGenerator,
  target: { businessId: string; employeeId: string; branchId: string },
  before: readonly WeekdayDefaultShift[], after: readonly WeekdayDefaultShift[], at: Date) {
  await tx.execute(sql`DELETE FROM employee_default_shifts WHERE company_id=${actor.companyId}
    AND employee_id=${target.employeeId} AND branch_id=${target.branchId}`);
  if (after.length) {
    const rows = after.map((shift) => sql`(${actor.companyId},${target.businessId},${target.employeeId},
      ${target.branchId},${shift.day},${shift.start},${shift.end},${shift.break_start ?? null},
      ${shift.break_end ?? null},${actor.userId},${at})`);
    await tx.execute(sql`INSERT INTO employee_default_shifts
      (company_id,business_id,employee_id,branch_id,day,start,"end",break_start,break_end,updated_by,updated_at)
      VALUES ${sql.join(rows, sql`,`)}`);
  }
  const snapshot = (shifts: readonly WeekdayDefaultShift[]) => ({ branch_id: target.branchId,
    shifts: shifts.map((shift) => ({ ...shift,
      break_start: shift.break_start ?? null, break_end: shift.break_end ?? null })) });
  await appendAuditLog(tx, ids.newId(), { entity: 'employee_default_shifts', entityId: target.employeeId,
    action: 'updated', before: snapshot(before), after: snapshot(after) });
}

function persistenceError(error: unknown): never {
  if (error instanceof EmployeeDefaultShiftsError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause &&
    ['40001','40P01','55P03'].includes(String(cause.code)))
    throw new EmployeeDefaultShiftsError('TRANSACTION_RETRY_REQUIRED');
  throw error;
}

export function createEmployeeDefaultShiftsTransactions(database: TenantWrappers,
  ids: IdGenerator): EmployeeDefaultShiftsTransactions {
  return { run: async (actor, work) => {
    try {
      return await database.withTenant(actor.companyId, async (tx) => {
        let target: { businessId: string; employeeId: string; branchId: string } | undefined;
        return work({
          authorize: (businessId) => authorize(tx, actor, businessId),
          employee: async (businessId, employeeId, branchId) => {
            const result = await lockEmployee(tx, actor, businessId, employeeId, branchId);
            target = { businessId, employeeId, branchId };
            return result;
          },
          current: (employeeId, branchId) => current(tx, actor.companyId, employeeId, branchId),
          replace: (before, after, at) => {
            if (!target) throw new Error('EMPLOYEE_HOURS_TARGET_MISSING');
            return replace(tx, actor, ids, target, before, after, at);
          },
        });
      }, { userId: actor.userId });
    } catch (error) { return persistenceError(error); }
  } };
}
