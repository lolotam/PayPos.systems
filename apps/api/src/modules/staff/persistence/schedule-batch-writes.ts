import { appendAuditLogs, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ScheduleError, type ScheduleRecord } from '../domain/schedule-types.ts';
type Plan = { before: ScheduleRecord | null; after: ScheduleRecord };

// أمر واحد لإنشاء الأغلفة وأمر واحد لتعديلها؛ العدد يرجع للتحقق من جميع الإصدارات معاً.
async function saveHeaders(tx: Tx, companyId: string, plans: readonly Plan[]) {
  const creates = plans
    .filter((p) => p.before === null)
    .map(
      ({ after: a }) =>
        sql`(${companyId},${a.id},${a.business_id},${a.branch_id},${a.employee_id},${a.week_start}::date,${a.timezone},${a.revision})`,
    );
  if (creates.length)
    await tx.execute(
      sql`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision) VALUES ${sql.join(creates, sql`,`)}`,
    );
  const updates = plans.flatMap(({ before: b, after: a }) =>
    b
      ? [sql`(${a.id}::uuid,${b.revision}::integer,${a.revision}::integer,${a.timezone}::text)`]
      : [],
  );
  if (!updates.length) return;
  const changed =
    await tx.execute(sql`UPDATE staff_schedules s SET revision=v.revision,timezone=v.timezone
    FROM (VALUES ${sql.join(updates, sql`,`)}) AS v(id,expected,revision,timezone)
    WHERE s.company_id=${companyId} AND s.id=v.id AND s.revision=v.expected RETURNING s.id`);
  if (changed.length !== updates.length) throw new ScheduleError('SCHEDULE_REVISION_CONFLICT');
}
// مكونات كل الأهداف تزال قبل أي إدخال لمنع تداخل مؤقت عند استبدال أسبوعين متجاورين.
export async function saveScheduleBatch(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  plans: readonly Plan[],
  reason?: string,
) {
  const existing = plans.flatMap((p) => (p.before ? [sql`${p.before.id}::uuid`] : []));
  if (existing.length)
    await tx.execute(
      sql`DELETE FROM staff_schedule_shifts WHERE company_id=${companyId} AND schedule_id IN (${sql.join(existing, sql`,`)})`,
    );
  await saveHeaders(tx, companyId, plans);
  const shifts = plans.flatMap(({ after: a }) =>
    a.shifts.map((s) => ({ ...s, id: ids.newId(), schedule_id: a.id, employee_id: a.employee_id })),
  );
  // jsonb_to_recordset يمنع آلاف معاملات SQL مع الاحتفاظ بإدخال ذري واحد.
  if (shifts.length)
    await tx.execute(sql`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT ${companyId},x.id,x.schedule_id,x.employee_id,x.working_date,x.day,x.start,x."end",x.starts_at,x.ends_at
    FROM jsonb_to_recordset(${JSON.stringify(shifts)}::jsonb) AS x(id uuid,schedule_id uuid,employee_id uuid,working_date date,day integer,start text,"end" text,starts_at timestamptz,ends_at timestamptz)`);
  await appendAuditLogs(
    tx,
    plans.map(({ before, after }) => ({
      id: ids.newId(),
      entry: {
        entity: 'staff_schedule',
        entityId: after.id,
        action: before === null ? 'created' : 'updated',
        before,
        after: { ...after, reason: reason ?? null },
      },
    })),
  );
}
