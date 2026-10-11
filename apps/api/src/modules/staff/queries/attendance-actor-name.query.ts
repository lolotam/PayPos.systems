import { sql, type SQL } from 'drizzle-orm';

// شاشات إجراءات الحضور تختار أصغر (business_id,id) للاسم كي تبقى النتيجة ثابتة عند تعدد سجلات المستخدم.
export function attendanceActorNameStatement(companyId: SQL, userId: SQL) {
  return sql`(SELECT jsonb_build_object('ar',actor.name_ar,'en',actor.name_en)
    FROM employees actor WHERE actor.company_id=${companyId} AND actor.user_id=${userId}
      AND actor.deleted_at IS NULL ORDER BY actor.business_id,actor.id LIMIT 1)`;
}
