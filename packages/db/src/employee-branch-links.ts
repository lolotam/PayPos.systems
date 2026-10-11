import { sql, type SQL } from 'drizzle-orm';

export interface BranchDay {
  branchId: string;
  today: string;
}

// شاشات إدارة الموظفين وفحوص سلطة التعديل تحتاج يوم الفرع مع بديل النشاط كي لا يغيّر اختلاف التوقيت نطاق الإذن.
export function branchToday() {
  return sql`COALESCE((SELECT (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(br.timezone,bu.timezone))::date
    FROM branches br JOIN businesses bu ON bu.company_id=br.company_id AND bu.id=br.business_id
    WHERE br.company_id=eb.company_id AND br.id=eb.branch_id),'-infinity'::date)`;
}

// ملف الموظف وقوائمه وفحوص سلطة التعديل تشترك في الشرط كي لا يُسقط ارتباط ينتهي لاحقاً من فحص كل الفروع.
export function currentAttachment(daysOrToday?: readonly BranchDay[] | SQL) {
  const today =
    daysOrToday === undefined
      ? branchToday()
      : Array.isArray(daysOrToday)
        ? dayFromClock(daysOrToday)
        : daysOrToday;
  return sql`(eb."to" IS NULL OR eb."to" > ${today})`;
}

function dayFromClock(days: readonly BranchDay[]) {
  const ids = sql`ARRAY[${sql.join(
    days.map((day) => sql`${day.branchId}::uuid`),
    sql`,`,
  )}]::uuid[]`;
  const dates = sql`ARRAY[${sql.join(
    days.map((day) => sql`${day.today}::date`),
    sql`,`,
  )}]::date[]`;
  return sql`COALESCE((SELECT d.today FROM unnest(${ids},${dates}) AS d(branch_id,today)
    WHERE d.branch_id=eb.branch_id),'-infinity'::date)`;
}
