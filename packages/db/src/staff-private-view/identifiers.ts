import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * يوحد مالك تنسيق معرّف النافذة حتى لا تختلف كتابة auth وحذف db عنه.
 *
 * @param sessionId معرّف صف الجلسة المالك للنافذة
 * @returns معرّف صف النافذة في verification
 */
export function staffPrivateViewIdentifier(sessionId: string): string {
  return `staff-private-view:v1:${sessionId}`;
}

/**
 * يفصل عداد الترتيب عن النافذة لأن عمره عمر الجلسة، لا عمر الخمس دقائق.
 *
 * @param sessionId معرّف صف الجلسة المالك للعداد
 * @returns معرّف صف عداد النافذة في verification
 */
export function staffPrivateViewSequenceIdentifier(sessionId: string): string {
  return `staff-private-view-seq:v1:${sessionId}`;
}

/**
 * يحذف النافذة وعدادها في معاملة إنهاء الجلسة نفسها حتى لا يعيد فتح متزامن صفاً يتيمًا.
 *
 * @param tx معاملة pospay_auth المفتوحة بالفعل
 * @param sessionIds صفوف الجلسات التي حُذفت وأعادت معرّفاتها
 * @returns وعد بلا نتيجة بعد حذف المعرّفين لكل جلسة
 */
export async function deleteStaffPrivateViewRows(
  tx: Pick<PostgresJsDatabase, 'execute'>,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  const identifiers = sessionIds.flatMap((sessionId) => [
    staffPrivateViewIdentifier(sessionId),
    staffPrivateViewSequenceIdentifier(sessionId),
  ]);
  await tx.execute(sql`
    DELETE FROM verification WHERE identifier IN (${sql.join(
      identifiers.map((identifier) => sql`${identifier}`),
      sql`, `,
    )})`);
}

/**
 * يمسح صفوف نوافذ العرض الخاص المنتهية وصفوف عدّاداتها التي انتهى موعد جلستها المطلق أو حُذفت،
 * بالحدّ نفسه المستخدم في تنظيف تحديات OTP حتى تتّبع الاحتفاظ الموحّد دون جدول أو صلاحية جديدة (#776).
 *
 * @param tx معاملة pospay_auth المفتوحة بالفعل
 * @param limit الحد الأقصى لعدد الصفوف المحذوفة في الدورة الواحدة (بين 1 و 100)
 * @returns وعد بلا نتيجة بعد تنظيف الدفعة
 */
export async function sweepStaffPrivateViewRows(
  tx: Pick<PostgresJsDatabase, 'execute'>,
  limit: number,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('OTP_RETENTION_INVALID');
  }
  await tx.execute(sql`
    DELETE FROM verification
    WHERE id IN (
      SELECT v.id
      FROM verification v
      WHERE (
        v.identifier LIKE 'staff-private-view:v1:%'
        AND v.expires_at < clock_timestamp()
      )
      OR (
        v.identifier LIKE 'staff-private-view-seq:v1:%'
        AND NOT EXISTS (
          SELECT 1
          FROM session s
          WHERE s.id = substring(
            v.identifier
            FROM '^staff-private-view-seq:v1:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
          )::uuid
            AND s.purpose = 'STAFF_POS'
            AND s.staff_absolute_deadline > clock_timestamp()
        )
      )
      ORDER BY v.expires_at, v.id
      LIMIT ${limit}
    )`);
}
