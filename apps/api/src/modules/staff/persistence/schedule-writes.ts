import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  ScheduleError,
  type ScheduleRecord,
  type TemplateRecord,
} from '../domain/schedule-types.ts';

export async function saveScheduleWeek(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  before: ScheduleRecord | null,
  after: ScheduleRecord,
  reason?: string,
) {
  if (before === null) {
    await tx.execute(sql`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
      VALUES(${companyId},${after.id},${after.business_id},${after.branch_id},${after.employee_id},${after.week_start},${after.timezone},${after.revision})`);
  } else {
    const changed =
      await tx.execute(sql`UPDATE staff_schedules SET timezone=${after.timezone},revision=${after.revision}
      WHERE company_id=${companyId} AND id=${after.id} AND revision=${before.revision} RETURNING id`);
    if (changed.length !== 1) throw new ScheduleError('SCHEDULE_REVISION_CONFLICT');
    await tx.execute(
      sql`DELETE FROM staff_schedule_shifts WHERE company_id=${companyId} AND schedule_id=${after.id}`,
    );
  }
  if (after.shifts.length > 0) {
    const values = after.shifts.map(
      (s) =>
        sql`(${companyId},${ids.newId()},${after.id},${after.employee_id},${s.working_date},${s.day},${s.start},${s.end},${s.starts_at},${s.ends_at})`,
    );
    await tx.execute(
      sql`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at) VALUES ${sql.join(values, sql`,`)}`,
    );
  }
  await appendAuditLog(tx, ids.newId(), {
    entity: 'staff_schedule',
    entityId: after.id,
    action: before === null ? 'created' : 'updated',
    before,
    after: { ...after, reason: reason ?? null },
  });
}
export async function saveShiftTemplate(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  before: TemplateRecord | null,
  after: TemplateRecord,
) {
  if (before === null) {
    await tx.execute(sql`INSERT INTO staff_shift_templates(company_id,id,business_id,name_en,name_ar,shifts,revision,archived_at)
      VALUES(${companyId},${after.id},${after.business_id},${after.name_en},${after.name_ar},${JSON.stringify(after.shifts)}::jsonb,${after.revision},${after.archived_at})`);
  } else {
    const changed =
      await tx.execute(sql`UPDATE staff_shift_templates SET name_en=${after.name_en},name_ar=${after.name_ar},shifts=${JSON.stringify(after.shifts)}::jsonb,revision=${after.revision},archived_at=${after.archived_at}
      WHERE company_id=${companyId} AND id=${after.id} AND revision=${before.revision} RETURNING id`);
    if (changed.length !== 1) throw new ScheduleError('SCHEDULE_REVISION_CONFLICT');
  }
  await appendAuditLog(tx, ids.newId(), {
    entity: 'shift_template',
    entityId: after.id,
    action: after.archived_at !== null ? 'archived' : before === null ? 'created' : 'updated',
    before,
    after,
  });
}
export function schedulePersistenceError(error: unknown): never {
  if (error instanceof ScheduleError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    if (String(cause.code) === '23P01') throw new ScheduleError('SCHEDULE_SHIFT_OVERLAP');
    if (String(cause.code) === '23505') throw new ScheduleError('SCHEDULE_REVISION_CONFLICT');
    if (['40001', '40P01'].includes(String(cause.code)))
      throw new ScheduleError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('SCHEDULE_PERSISTENCE_FAILED');
}
