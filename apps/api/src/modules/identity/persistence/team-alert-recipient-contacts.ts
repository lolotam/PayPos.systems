import { uuidArray, type Tx } from '@pospay/db';
import { TEAM_ALERT_REQUIRE_VERIFIED_EMAIL, type TeamAlertContact } from '@pospay/domain';
import { sql } from 'drizzle-orm';

/** سقف المعرّفات في نداء واحد للدالة؛ فوقه الدالة نفسها بترفض (ADR-0003 §6a). */
const CONTACT_READ_CHUNK = 100;

/**
 * جهات اتصال أعضاء الفريق المؤهلين لتنبيه خارجي (إيميل أو واتساب)، من دالة القراءة المحدودة `team_alert_recipient_contacts`
 * على معاملة المستأجر نفسها (ADR-0003 §6a، AL-Q6). الدالة هي المسار الوحيد: مفيش صلاحية مباشرة على جدول المستخدمين.
 * مستخدم من غير جهة صالحة أو من غير عضوية سارية ما بيظهرش في النتيجة. العناوين وأرقام الهاتف ما بتتسجلش ولا بتتحط في أي رسالة خطأ.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة (لازم تطابق سياق المعاملة وإلا الدالة بترفض)
 * @param userIds المستخدمين المطلوبين؛ بتتقسم لمجموعات من مئة
 * @param at لحظة نافذة العضوية
 * @param options.requireVerifiedEmail مفتاح GR-003(d): الإيميل غير الموثّق ما بيتعرضش لما يكون true (الافتراضي من الدومين)
 * @returns جهة اتصال لكل مستخدم عنده وجهة واحدة على الأقل
 */
export async function teamAlertRecipientContacts(
  tx: Tx,
  companyId: string,
  userIds: readonly string[],
  at: Date,
  options: { readonly requireVerifiedEmail?: boolean } = {},
): Promise<Map<string, TeamAlertContact>> {
  const requireVerified = options.requireVerifiedEmail ?? TEAM_ALERT_REQUIRE_VERIFIED_EMAIL;
  const contacts = new Map<string, TeamAlertContact>();
  const unique = [...new Set(userIds)];
  for (let start = 0; start < unique.length; start += CONTACT_READ_CHUNK) {
    const chunk = unique.slice(start, start + CONTACT_READ_CHUNK);
    const rows = await tx.execute<{
      user_id: string;
      email: string | null;
      phone_number: string | null;
    }>(sql`SELECT user_id, email, phone_number FROM public.team_alert_recipient_contacts(
      ${companyId}::uuid, ${uuidArray(chunk)}, ${at.toISOString()}::timestamptz, ${requireVerified}::boolean)`);
    for (const row of rows)
      contacts.set(row.user_id, { email: row.email, phoneNumber: row.phone_number });
  }
  return contacts;
}
