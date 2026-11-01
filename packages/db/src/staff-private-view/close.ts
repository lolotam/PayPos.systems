import { sql } from 'drizzle-orm';

import type { AuthDatabase } from '../auth-database.ts';
import { staffPrivateViewIdentifier } from './identifiers.ts';

/** طلب قفل نافذة: الجلسة صاحبة النافذة والمفتاح العشوائي اللي حمله الطلب. */
export type StaffPrivateViewCloseRequest = {
  readonly sessionId: string;
  readonly windowId: string;
};

/**
 * يقفل النافذة المسماة فقط؛ بقاء عداد الجلسة يحفظ ترتيب window_seq للفتح التالي.
 *
 * @param database واجهة pospay_auth
 * @param request الجلسة ومفتاح النافذة المطلوب قفلها
 * @returns true عند حذف صفها، وfalse لطلب متأخر أو مفتاح مختلف
 */
export async function closeStaffPrivateView(
  database: AuthDatabase,
  request: StaffPrivateViewCloseRequest,
): Promise<boolean> {
  const deleted = await database.db.execute<{ id: string }>(sql`
    DELETE FROM verification WHERE identifier=${staffPrivateViewIdentifier(request.sessionId)}
      AND value::jsonb->>'window_id'=${request.windowId} RETURNING id`);
  return deleted.length > 0;
}
