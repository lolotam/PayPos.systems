import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  RatingSettingsTransactions,
  SaveRatingSettingsInput,
} from '../ports/rating-settings.port.ts';

/**
 * بيقفل صف النشاط ويقرا قيمة المفتاح المخزّنة.
 * القفل على صف النشاط مش على صف المفتاح: صف النشاط موجود دايماً، فكتابتين على نفس
 * النشاط بتتقفوا على بعض حتى لو مفيش صف مفتاح لسه.
 * القفل FOR NO KEY UPDATE مش FOR UPDATE: التحقق من أي مفتاح أجنبي بياخد قفل
 * FOR KEY SHARE على صف النشاط، وFOR UPDATE بيوقف إدخال الجلسات والفروع وطلبات التقييم.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param businessId النشاط
 * @returns القيمة المخزّنة، أو null لو مفيش صف للمفتاح
 */
async function lockAndRead(tx: Tx, companyId: string, businessId: string): Promise<boolean | null> {
  await tx.execute(
    sql`SELECT id FROM businesses WHERE company_id=${companyId} AND id=${businessId} FOR NO KEY UPDATE`,
  );
  const [row] = await tx.execute<{ requests_enabled: boolean | null }>(sql`SELECT requests_enabled
    FROM rating_settings WHERE company_id=${companyId} AND business_id=${businessId}`);
  return row?.requests_enabled ?? null;
}

/**
 * بيكتب القيمة الجديدة: إدراج أول مرة أو تعديل، ورقم المراجعة بيتزوّد مع كل تعديل.
 *
 * @param tx        معاملة الشركة
 * @param ids       مولّد الـ ids لصف المفتاح
 * @param companyId الشركة
 * @param input     النشاط والقيمة الجديدة ومن نفّذ التغيير ولحظة التغيير
 * @returns بيخلص لما القيمة تتكتب
 */
async function upsert(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  input: SaveRatingSettingsInput,
): Promise<void> {
  await tx.execute(sql`INSERT INTO rating_settings
    (company_id, id, business_id, requests_enabled, updated_by, updated_at, revision)
    VALUES (${companyId}, ${ids.newId()}, ${input.businessId}, ${input.enabled},
      ${input.actorId}, ${input.now.toISOString()}, 1)
    ON CONFLICT (company_id, business_id) DO UPDATE SET requests_enabled = EXCLUDED.requests_enabled,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at,
      revision = rating_settings.revision + 1`);
}

/**
 * مفتاح طلبات التقييم: الكتابة والتدقيق كلهم جوه معاملة واحدة للشركة.
 * الكتابة upsert على (company_id, business_id) — صف واحد لكل نشاط بيتحدّث مكانش بينضاف.
 *
 * @param db  أغلفة الداتابيز المستأجرة
 * @param ids مولّد الـ ids لصف المفتاح وسجل التدقيق
 * @returns معاملة مفتاح طلبات التقييم
 */
export function createRatingSettingsTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): RatingSettingsTransactions {
  return {
    run: async (companyId, userId, work) =>
      db.withTenant(
        companyId,
        async (tx) =>
          work({
            audit: { record: (entry) => appendAuditLog(tx, ids.newId(), entry) },
            lockAndRead: (businessId) => lockAndRead(tx, companyId, businessId),
            save: (input) => upsert(tx, ids, companyId, input),
          }),
        { userId },
      ),
  };
}
