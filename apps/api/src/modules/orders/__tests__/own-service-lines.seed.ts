import { expect } from 'vitest';
import { cancelServiceLine } from '../../../../../../packages/db/test/service-line-cancellation.ts';
import { ids, must, type TipFixture } from '../../../../test/session-tips.fixture.ts';

export interface PerfScope {
  companyId: string;
  businessId: string;
  branchId: string;
  employeeIds: string[];
  sampleSessionId: string;
  sampleLineId: string;
  membershipId: string;
}

// نشاط تركيبي كامل لشركة جديدة (نشاط، فرع، عميل، خدمة، أربعة موظفين، عضوية مسجِّلة)، ثم زيارة عينة بالاستخدام الحقيقي.
export async function newPerfScope(f: TipFixture, name: string): Promise<PerfScope> {
  const companyId = await f.h.onboard(f.cookie, name);
  const businessId = ids.newId(),
    branchId = ids.newId(),
    customerId = ids.newId(),
    serviceId = ids.newId(),
    membershipId = ids.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type,timezone)
    VALUES(${companyId},${businessId},'Synthetic perf business','salon','Asia/Kuwait')`;
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${companyId},${branchId},${businessId},'Synthetic perf branch')`;
  await f.h
    .owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z' WHERE company_id=${companyId}`;
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${companyId},${customerId},'Synthetic perf customer','+999999998125','en',now(),now())`;
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${companyId},${serviceId},${businessId},'Synthetic perf service','25.000','ZERO')`;
  const employeeIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const employeeId = ids.newId();
    employeeIds.push(employeeId);
    await f.h
      .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES(${companyId},${employeeId},${businessId},${branchId},${`Perf employee ${i}`},${`perf employee ${i}`},'staff','2026-01-01',${301 + i})`;
    await f.h
      .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
      VALUES(${companyId},${ids.newId()},${businessId},${employeeId},${branchId},'2026-01-01')`;
  }
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,limit_bps)
    SELECT ${companyId},${membershipId},${f.userId},role_id,role_owner_key,'BRANCH',${branchId},'2026-01-01',limit_bps
    FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  const saved = await f.create.execute({
    ...f.context(),
    companyId,
    businessId,
    branchId,
    input: {
      customer_id: customerId,
      occurred_at: '2026-10-14T08:00:00.000Z',
      recorder_membership_id: membershipId,
      lines: [{ ...f.line(serviceId), performers: [{ employee_id: must(employeeIds[1]) }] }],
    },
  });
  return {
    companyId,
    businessId,
    branchId,
    employeeIds,
    sampleSessionId: saved.session.id,
    sampleLineId: must(saved.session.lines[0]).id,
    membershipId,
  };
}

// عينة الشركة الأصلية للتثبيت: زيارتها الحقيقية هي النسخة المرجعية، وموظفوها هم موظفو التثبيت.
export function homePerfScope(f: TipFixture, sessionId: string, lineId: string): PerfScope {
  return {
    companyId: f.company,
    businessId: f.business,
    branchId: f.branch,
    employeeIds: f.employees,
    sampleSessionId: sessionId,
    sampleLineId: lineId,
    membershipId: f.membership,
  };
}

const lineColumns = `company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
  list_price,price,discount,net,effective_discount_bps,limit_bps_applied,limit_source,name_en,name_ar,catalog_revision,
  rule_kind,rule_pct_bps,rule_fixed_amount,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late`;

// الدفعة الواحدة فوق 10,000 زيارة تتجاوز مهلة 30 ثانية بسبب فحص المفاتيح الأجنبية لكل صف، فتدخل بلا مشغّلات FK
// على اتصال المالك وحده (SET LOCAL داخل معاملتها)؛ بياناتها متسقة بالبناء، والأحجام الأصغر تبقى بالمسار العادي.
async function runBulk(f: TipFixture, fast: boolean, text: string, params: (string | number)[]) {
  if (!fast) return f.h.owner.unsafe(text, params);
  return f.h.owner.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    return tx.unsafe(text, params);
  });
}

// ينسخ زيارة العينة إلى `count` زيارة بسطر لكل منها، يوزع منفذيها بالتناوب على أيام أكتوبر 2026 بلحظات
// متكررة عمداً كي تتساوى مفاتيح الترتيب. دفعة SQL واحدة، لا تشغّل ANALYZE ولا تلمس الإحصاءات.
export async function bulkVisits(f: TipFixture, s: PerfScope, count: number, performers: string[]) {
  await runBulk(
    f,
    count > 10_000,
    `WITH src AS (
      SELECT n,gen_random_uuid() AS session_id,gen_random_uuid() AS line_id,
        date '2026-10-01'+(n%28) AS day,(n%4) AS minute FROM generate_series(1,$4::int) n
    ), sessions AS (
      INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
        occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
      SELECT s.company_id,src.session_id,s.business_id,s.branch_id,s.customer_id,s.customer_name,s.customer_phone_masked,
        (src.day+time '08:00'+src.minute*interval '1 minute') AT TIME ZONE 'UTC',s.recorded_at,src.day,s.business_timezone,
        s.recorded_by,s.recorded_by_membership_id,s.late
      FROM src CROSS JOIN service_sessions s WHERE s.company_id=$1 AND s.id=$2 RETURNING id
    ), lines AS (
      INSERT INTO service_lines(${lineColumns})
      SELECT l.company_id,src.line_id,l.business_id,src.session_id,l.service_id,l.ordinal,l.input_index,l.status,l.revision,
        l.list_price,l.price,l.discount,l.net,l.effective_discount_bps,l.limit_bps_applied,l.limit_source,l.name_en,l.name_ar,l.catalog_revision,
        l.rule_kind,l.rule_pct_bps,l.rule_fixed_amount,l.counts_toward_threshold,false,
        l.recorded_by,l.recorded_by_membership_id,l.recorded_at,l.late
      FROM src JOIN sessions ON sessions.id=src.session_id
      CROSS JOIN service_lines l WHERE l.company_id=$1 AND l.id=$3 RETURNING id
    )
    INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,
      not_clocked_in_warning,approved_leave_warning)
    SELECT $1::uuid,gen_random_uuid(),$5::uuid,src.line_id,($6::uuid[])[1+src.n%$7::int],1,10000,'Perf performer',NULL,false,false
    FROM src JOIN lines ON lines.id=src.line_id`,
    [
      s.companyId,
      s.sampleSessionId,
      s.sampleLineId,
      count,
      s.businessId,
      uuidArray(performers),
      performers.length,
    ],
  );
}

const uuidArray = (values: readonly string[]) => `{${values.join(',')}}`;

// سطر ثانٍ على `count` زيارة من زياراتها: ينقلها من 600 سطر إلى 602 بلا زيارات جديدة.
export async function secondLines(f: TipFixture, s: PerfScope, employeeId: string, count: number) {
  await f.h.owner.unsafe(
    `WITH picked AS (
      SELECT sl.session_id FROM line_performers p JOIN service_lines sl
        ON sl.company_id=p.company_id AND sl.business_id=p.business_id AND sl.id=p.line_id
      WHERE p.company_id=$1 AND p.business_id=$2 AND p.employee_id=$3
      ORDER BY sl.session_id LIMIT $4::int
    ), added AS (
      INSERT INTO service_lines(${lineColumns})
      SELECT l.company_id,gen_random_uuid(),l.business_id,picked.session_id,l.service_id,2,1,l.status,l.revision,
        l.list_price,l.price,l.discount,l.net,l.effective_discount_bps,l.limit_bps_applied,l.limit_source,l.name_en,l.name_ar,l.catalog_revision,
        l.rule_kind,l.rule_pct_bps,l.rule_fixed_amount,l.counts_toward_threshold,false,
        l.recorded_by,l.recorded_by_membership_id,l.recorded_at,l.late
      FROM picked CROSS JOIN service_lines l WHERE l.company_id=$1 AND l.id=$5 RETURNING id
    )
    INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,
      not_clocked_in_warning,approved_leave_warning)
    SELECT $1::uuid,gen_random_uuid(),$2::uuid,added.id,$3::uuid,1,10000,'Perf performer',NULL,false,false FROM added`,
    [s.companyId, s.businessId, employeeId, count, s.sampleLineId],
  );
}

// سطور الزميلات الملغاة: تملأ جدول الإلغاءات بصفوف شركائها في المستأجر نفسه، فجملة الإلغاءات السادسة تُفحص على جدول
// فيه عشرات الصفوف لا صفان. تمر بنفس المسار الحقيقي ولا تدخل في الترتيب المرجعي لها. سطر العينة مستبعد لأن الدفعات بتنسخ حالته.
export async function cancelColleagueLines(
  f: TipFixture,
  s: PerfScope,
  her: string,
  count: number,
) {
  const rows = await f.h.owner`SELECT line_id FROM line_performers
    WHERE company_id=${s.companyId} AND business_id=${s.businessId} AND employee_id<>${her}
      AND line_id<>${s.sampleLineId}
    ORDER BY line_id LIMIT ${count}`;
  expect(rows.length).toBe(count);
  await cancelPerfLines(
    f,
    s,
    rows.map((row) => String(row['line_id'])),
  );
}

// يلغي سطوراً محددة بالمسار الحقيقي للإلغاء (سطر + صف إلغاء)، فتظهر في الصفحة ملغاة وبلحظة إلغاء. لا ANALYZE ولا تغيير إحصاءات.
export async function cancelPerfLines(f: TipFixture, s: PerfScope, lineIds: readonly string[]) {
  for (const lineId of lineIds)
    await f.db.withTenant(
      s.companyId,
      (tx) =>
        cancelServiceLine(tx, {
          companyId: s.companyId,
          lineId,
          expectedRevision: 1,
          cancelledBy: f.userId,
          membershipId: s.membershipId,
          cancellationId: ids.newId(),
        }),
      { userId: f.userId },
    );
}
