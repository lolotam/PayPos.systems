import { sql, type SQL } from 'drizzle-orm';

// شاشات إجراءات الحضور تفضّل سجل النشاط، ثم السجل غير المحذوف؛ الاسم التاريخي يبقى بعد المغادرة والتعادل ثابت.
export function attendanceActorNameStatement(companyId: SQL, userId: SQL, businessId: SQL) {
  return sql`(SELECT jsonb_build_object('ar',actor.name_ar,'en',actor.name_en)
    FROM employees actor WHERE actor.company_id=${companyId} AND actor.user_id=${userId}
    ORDER BY (actor.business_id=${businessId}) DESC, (actor.deleted_at IS NULL) DESC,
      actor.business_id,actor.id LIMIT 1)`;
}
