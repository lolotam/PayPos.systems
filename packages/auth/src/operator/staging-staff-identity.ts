import { createAuthDatabase } from '@pospay/db';
import { sql } from 'drizzle-orm';

type IdentityRow = {
  kind: 'email' | 'phone';
  id: string;
  phone: string | null;
  phone_approved: boolean;
};

/**
 * يقرأ تطابق الإيميل والهاتف معاً قبل إنشاء مستخدم PP-58.3، حتى لا يتكرر مالك الهاتف أو تتعارض الهوية.
 * واجهة operator محدودة لـ staging ولا تظهر في المدخل العام ولا تكشف عميل قاعدة البيانات للمستدعي.
 *
 * @param input اتصال pospay_auth والإيميل المشتق والهاتف القانوني المطلوب التوفيق بينهما
 * @returns هوية مالك الإيميل مع حالة اعتماد هاتفه، ومعرف مالك الهاتف سواء كان معتمداً أم لا
 */
export async function readStagingStaffIdentity(input: {
  authDatabaseUrl: string;
  email: string;
  phone: string;
}): Promise<{
  emailUser: { id: string; phone: string | null; phoneApproved: boolean } | null;
  phoneOwnerId: string | null;
}> {
  const database = createAuthDatabase({ url: input.authDatabaseUrl, maxConnections: 1 });
  try {
    await database.ping();
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
  } finally {
    await database.close();
  }
}
