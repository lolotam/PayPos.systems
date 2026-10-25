import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { SessionLine, SessionRecord } from '../domain/session-types.ts';
import { sessionLineSnapshot } from '../domain/session-snapshot.ts';

export async function insertSession(tx: Tx, companyId: string, record: SessionRecord) {
  await tx.execute(sql`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late,created_at)
    VALUES(${companyId},${record.id},${record.business_id},${record.branch_id},${record.customer.id},${record.customer.name},${record.customer.phone_masked},
      ${record.recorded_by},${record.recorded_by_membership_id},${record.occurred_at.toISOString()},${record.recorded_at.toISOString()},
      ${record.business_date},${record.business_timezone},${record.late},${record.recorded_at.toISOString()})`);
}

export async function insertLines(tx: Tx, companyId: string, businessId: string, lines: readonly SessionLine[]) {
  const rows = lines.map(sessionLineSnapshot);
  // معرّف الموافقة يُقرأ من حقائق السطر لا من لقطة العرض، فالسطر بلا موافقة يكتب NULL.
  const values = rows.map((line, index) => sql`(${companyId},${line.id},${businessId},${line.session_id},${line.service_id},${line.ordinal},${line.input_index},
    ${line.status},${line.revision},${line.list_price},${line.price},${line.discount},${line.net},${line.effective_discount_bps},${line.limit_bps_applied},
    ${line.limit_source},${line.name_en},${line.name_ar},${line.catalog_revision},${line.rule_snapshot.kind},
    ${line.rule_snapshot.kind === 'PCT' ? line.rule_snapshot.value : null},${line.rule_snapshot.kind === 'FIXED' ? line.rule_snapshot.value : null},
    ${line.counts_snapshot},${line.has_performer_warning},${line.recorded_by},${line.recorded_by_membership_id},${line.recorded_at},${line.late},${line.recorded_at},
    ${lines[index]?.discount_proposal_id ?? null})`);
  await tx.execute(sql`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
    list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,rule_kind,rule_pct_bps,rule_fixed_amount,
    counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late,created_at,discount_proposal_id) VALUES ${sql.join(values, sql`,`)}`);
  // الرابط يُقرأ من حقائق الكتابة لا من لقطة الاستجابة، حتى لا يصل معرّف المستخدم إلى الرد ولا إلى الحدث.
  // يُربط بالموظف نفسه لا بالموضع، وغيابه خطأ لا قيمة null: الصف لا يتغير بعد الإدخال فلا يمكن تصحيحه.
  const linkedUser = (lineIndex: number, employeeId: string) => {
    const performer = lines[lineIndex]?.performers.find((candidate) => candidate.employee.id === employeeId);
    if (performer === undefined) throw new Error('Performer missing from the recorded line');
    return performer.employee.user_id;
  };
  const performers = rows.flatMap((line, i) => line.performers.map((p) => sql`(${companyId},${p.id},${businessId},${line.id},${p.employee_id},${p.performer_ordinal},
    ${p.share_bps},${p.name_en},${p.name_ar},${p.not_clocked_in_warning},${p.approved_leave_warning},${linkedUser(i, p.employee_id)},true)`));
  await tx.execute(sql`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,
    not_clocked_in_warning,approved_leave_warning,linked_user_id,linked_user_snapshotted) VALUES ${sql.join(performers, sql`,`)}`);
}
