import { sql } from 'drizzle-orm';

import type { AuthDatabase } from '../auth-database.ts';

type IdentityRow = {
  kind: 'email' | 'phone';
  id: string;
  phone: string | null;
  phone_approved: boolean;
};

/**
 * يقرأ مالك الإيميل ومالك الهاتف في استعلام واحد، عشان أي تعارض في الهوية يُرفض قبل أي كتابة.
 * الـ SQL عايش هنا في packages/db لأن دور pospay_auth ومخططات الهوية العامة تُدار من هنا، وpackages/auth يناديها فقط.
 *
 * @param database اتصال pospay_auth المفتوح من packages/auth
 * @param input الإيميل المشتق والهاتف القانوني المطلوب التوفيق بينهما
 * @returns هوية مالك الإيميل مع حالة اعتماد هاتفه، ومعرف مالك الهاتف سواء كان معتمداً أم لا
 */
export async function readStagingStaffIdentityRows(
  database: AuthDatabase,
  input: { email: string; phone: string },
): Promise<{
  emailUser: { id: string; phone: string | null; phoneApproved: boolean } | null;
  phoneOwnerId: string | null;
}> {
  const rows = await database.db.execute<IdentityRow>(sql`
      SELECT 'email' AS kind,id,phone_number AS phone,
        (phone_binding_approved_at IS NOT NULL) AS phone_approved
        FROM "user" WHERE email=${input.email}
      UNION ALL
      SELECT 'phone' AS kind,id,NULL AS phone,false AS phone_approved
        FROM "user" WHERE phone_number=${input.phone}`);
  const email = rows.find((row) => row.kind === 'email');
  const phone = rows.find((row) => row.kind === 'phone');
  return {
    emailUser:
      email === undefined
        ? null
        : { id: email.id, phone: email.phone, phoneApproved: email.phone_approved },
    phoneOwnerId: phone?.id ?? null,
  };
}
