import { createAuthDatabase } from '@pospay/db';
import { readStagingStaffIdentityRows } from '@pospay/db/operator/staging-staff';

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
    return await readStagingStaffIdentityRows(database, {
      email: input.email,
      phone: input.phone,
    });
  } finally {
    await database.close();
  }
}
