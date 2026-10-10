import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { DEFAULT_MAX_SHIFTS_PER_DAY, scheduleSettingsSource } from '../domain/schedule-settings.ts';
import { ScheduleError } from '../domain/schedule-types.ts';
import type {
  ScheduleSettingsRecord,
  BranchScheduleSettingsRecord,
  ScheduleSettingsTransactions,
} from '../ports/schedule-settings.port.ts';
import { schedulingAccess, schedulingContext } from './schedule-context.adapter.ts';
import { schedulePersistenceError } from './schedule-writes.ts';

async function settingsAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  lock: boolean,
) {
  if (!(await schedulingContext(tx, companyId, businessId, null))) return 'NOT_FOUND' as const;
  const decision = await schedulingAccess(
    tx,
    companyId,
    userId,
    businessId,
    null,
    'settings',
    lock,
  );
  if (decision === 'DENIED') return 'NOT_FOUND' as const;
  if (lock && !(await schedulingContext(tx, companyId, businessId, null)))
    return 'NOT_FOUND' as const;
  return decision;
}
export function createScheduleSettingsAccess() {
  return {
    branches: async (tx: Tx, companyId: string, businessId: string) =>
      (await schedulingContext(tx, companyId, businessId, null))?.branchIds ?? [],
    read: (tx: Tx, companyId: string, userId: string, businessId: string) =>
      settingsAccess(tx, companyId, userId, businessId, false),
  };
}
export function createScheduleSettingsTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): ScheduleSettingsTransactions {
  return {
    run: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) =>
            work({
              branch: async (businessId, branchId) => {
                if (!(await schedulingContext(tx, companyId, businessId, branchId)))
                  throw new ScheduleError('NOT_FOUND');
              },
              branchSettings: (businessId, branchId) =>
                readBranchSettings(tx, companyId, businessId, branchId),
              saveBranch: (before, after) =>
                writeBranchSettings(tx, companyId, userId, ids, before, after),
              clearBranch: (before) =>
                writeBranchSettings(tx, companyId, userId, ids, before, {
                  ...before,
                  max_shifts_per_day: null,
                  updated_at: null,
                }),
              authorize: async (businessId) => {
                const decision = await settingsAccess(tx, companyId, userId, businessId, true);
                if (decision !== 'ALLOWED') throw new ScheduleError(decision);
              },
              settings: async (businessId) => {
                const [row] = await tx.execute<{ max_shifts_per_day: number; updated_at: Date }>(
                  sql`SELECT max_shifts_per_day,updated_at FROM staff_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId} FOR UPDATE`,
                );
                return {
                  business_id: businessId,
                  max_shifts_per_day: row?.max_shifts_per_day ?? DEFAULT_MAX_SHIFTS_PER_DAY,
                  is_default: !row,
                  updated_at: row ? new Date(row.updated_at).toISOString() : null,
                };
              },
              save: (before, after) => saveSettings(tx, companyId, userId, ids, before, after),
            }),
          { userId },
        );
      } catch (error) {
        schedulePersistenceError(error);
      }
    },
  };
}
async function readBranchSettings(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<BranchScheduleSettingsRecord> {
  const [branch] = await tx.execute<{
    max_shifts_per_day: number;
    updated_at: Date;
  }>(sql`SELECT max_shifts_per_day,updated_at
    FROM staff_branch_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId} AND branch_id=${branchId} FOR UPDATE`);
  const [business] = await tx.execute<{ max_shifts_per_day: number }>(sql`SELECT max_shifts_per_day
    FROM staff_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId}`);
  return {
    business_id: businessId,
    branch_id: branchId,
    max_shifts_per_day: branch?.max_shifts_per_day ?? null,
    business_value: business?.max_shifts_per_day ?? null,
    updated_at: branch ? new Date(branch.updated_at).toISOString() : null,
  };
}
async function writeBranchSettings(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
  before: BranchScheduleSettingsRecord,
  after: BranchScheduleSettingsRecord,
) {
  if (after.max_shifts_per_day === null) {
    await tx.execute(
      sql`DELETE FROM staff_branch_schedule_settings WHERE company_id=${companyId} AND business_id=${after.business_id} AND branch_id=${after.branch_id}`,
    );
  } else {
    await tx.execute(sql`INSERT INTO staff_branch_schedule_settings(company_id,business_id,branch_id,max_shifts_per_day,updated_by,updated_at)
      VALUES(${companyId},${after.business_id},${after.branch_id},${after.max_shifts_per_day},${userId},${after.updated_at})
      ON CONFLICT(company_id,branch_id) DO UPDATE SET max_shifts_per_day=excluded.max_shifts_per_day,updated_by=excluded.updated_by,updated_at=excluded.updated_at`);
  }
  const snapshot = (record: BranchScheduleSettingsRecord) => ({
    branch_id: record.branch_id,
    max_shifts_per_day: record.max_shifts_per_day,
    source: scheduleSettingsSource(record.max_shifts_per_day, record.business_value),
  });
  await appendAuditLog(tx, ids.newId(), {
    entity: 'staff_branch_schedule_settings',
    entityId: after.branch_id,
    action: after.max_shifts_per_day === null ? 'deleted' : 'updated',
    before: snapshot(before),
    after: snapshot(after),
  });
}
async function saveSettings(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
  before: ScheduleSettingsRecord,
  after: ScheduleSettingsRecord,
) {
  await tx.execute(sql`INSERT INTO staff_schedule_settings(company_id,business_id,max_shifts_per_day,updated_by,updated_at)
    VALUES(${companyId},${after.business_id},${after.max_shifts_per_day},${userId},${after.updated_at})
    ON CONFLICT(company_id,business_id) DO UPDATE SET max_shifts_per_day=excluded.max_shifts_per_day,updated_by=excluded.updated_by,updated_at=excluded.updated_at`);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'staff_schedule_settings',
    entityId: after.business_id,
    action: 'updated',
    before: { max_shifts_per_day: before.max_shifts_per_day, is_default: before.is_default },
    after: { max_shifts_per_day: after.max_shifts_per_day },
  });
}
