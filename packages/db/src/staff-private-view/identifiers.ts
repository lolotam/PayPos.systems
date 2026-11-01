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
