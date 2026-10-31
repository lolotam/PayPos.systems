import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  RatingSettingsTransactions,
  SaveRatingSettingsInput,
} from '../ports/rating-settings.port.ts';

async function upsert(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  input: SaveRatingSettingsInput,
): Promise<{ before: boolean | null }> {
  // القراءة والكتابة في أمر واحد: القيمة القديمة بتتسجّل قبل ما الكتابة تشيلها.
  // الـ CTE اللي بيعدّل بيتنفّذ دايماً حتى لو محدش قرا مخرجه.
  const [row] = await tx.execute<{ previous_value: boolean | null }>(sql`
    WITH previous AS (
      SELECT requests_enabled FROM rating_settings
      WHERE company_id = ${companyId} AND business_id = ${input.businessId}
    ), upserted AS (
      INSERT INTO rating_settings (company_id, id, business_id, requests_enabled, updated_by, updated_at, revision)
      VALUES (${companyId}, ${ids.newId()}, ${input.businessId}, ${input.enabled}, ${input.actorId}, ${input.now.toISOString()}, 1)
      ON CONFLICT (company_id, business_id) DO UPDATE SET requests_enabled = EXCLUDED.requests_enabled,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at,
        revision = rating_settings.revision + 1
    )
    SELECT (SELECT requests_enabled FROM previous) AS previous_value`);
  return { before: row?.previous_value ?? null };
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
            save: (input) => upsert(tx, ids, companyId, input),
          }),
        { userId },
      ),
  };
}
