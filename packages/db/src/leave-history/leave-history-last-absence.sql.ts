import { sql, type SQL } from 'drizzle-orm';
import type { LeaveHistoryContext } from './types.ts';
import { historyCoverage, historyIds, type HistoryScope } from './leave-history-days.sql.ts';

function eligibleAbsence(c: LeaveHistoryContext, s: HistoryScope, asOf: string, bound: SQL) {
  // آخر غياب في ملف الموظف يحتاج وجود وردية منتهية، مش تجميع تفاصيل كل ورديات اليوم.
  return sql`FROM staff_schedule_shifts d
    WHERE d.company_id=${c.companyId} AND d.employee_id=${c.employeeId}::uuid
      AND d.working_date>=(SELECT hire_date FROM employee)
      AND ((SELECT contract_end FROM employee) IS NULL
        OR d.working_date<=(SELECT contract_end FROM employee))
      AND EXISTS (SELECT 1 FROM staff_schedules sc
        WHERE sc.company_id=d.company_id AND sc.id=d.schedule_id
          AND sc.business_id=${c.businessId}
          AND sc.branch_id=ANY(${historyIds(s.attendanceBranches)}) OFFSET 0)
      AND d.starts_at<${asOf}::timestamptz AND d.ends_at<=${asOf}::timestamptz
      AND NOT (SELECT coverage.session_any OR coverage.leave_any
        FROM (${historyCoverage(c, s)}) coverage)
      ${bound}`;
}

export function historyLatestAbsence(c: LeaveHistoryContext, s: HistoryScope, asOf: string) {
  // شاشة السجل: seed على index الموظف يبدأ من أحدث starts_at ويتوقف عند أول غياب مؤهل.
  // materialized يمنع إعادة البحث؛ لو مفيش غياب ممكن البحث يستنفد التاريخ كله.
  // working_date ناتج materializeSchedule/scheduleInstant من بداية الوردية المحلية، مش يوم نهايتها.
  // لأي W>S: البداية المحلية >= منتصف ليل S+1. إزاحات المناطق المدعومة أقل من 24 ساعة،
  // حتى التاريخية؛ إذن starts_at >= UTC(S+1 00:00)-24h. دي نافذة تصحيح ترتيب، مش lookback.
  // كل starts_at>seed.starts_at اتفحص بالفعل؛ بنشمل المساواة عشان أي ties ما تضيعش.
  // التحويل الصريح لـUTC وطرح ساعات ثابتة يمنع timezone جلسة DB وDST من تغيير الحد.
  // range seek ثم تطابق ID خارج LIMIT يحفظ point lookup حتى مع اختيار planner سيئ لجدول صغير.
  // OFFSET 0 يحافظ على فحص schedule لكل مرشح، بدل قلب البحث لمسح كل جداول الأسبوع.
  // على PostgreSQL 16.16 أخرج المخطط حدّ الـ 24 ساعة من Index Cond حين كُتب كتعبير من seed، فحُسب floor_at داخل seed كعمود عادي ليبقى شرط فهرس.
  return sql`(
    WITH employee AS MATERIALIZED (
      SELECT hit.hire_date,hit.contract_end FROM (
        SELECT e.id,e.business_id,e.deleted_at,e.hire_date,e.contract_end
        FROM employees e WHERE e.company_id=${c.companyId} AND e.id>=${c.employeeId}::uuid
        ORDER BY e.id LIMIT 1
      ) hit WHERE hit.id=${c.employeeId}::uuid AND hit.business_id=${c.businessId}
        AND hit.deleted_at IS NULL
    ), seed AS MATERIALIZED (
      SELECT d.working_date,d.starts_at,
        ((d.working_date+1)::timestamp AT TIME ZONE 'UTC')-interval '24 hours' AS floor_at
      ${eligibleAbsence(c, s, asOf, sql``)}
      ORDER BY d.starts_at DESC LIMIT 1
    )
    SELECT GREATEST(seed.working_date,refined.working_date)
    FROM seed CROSS JOIN LATERAL (
      SELECT MAX(d.working_date) AS working_date
      ${eligibleAbsence(
        c,
        s,
        asOf,
        sql`AND d.starts_at>=seed.floor_at
          AND d.starts_at<=seed.starts_at AND d.working_date>seed.working_date`,
      )}
    ) refined
  )`;
}
