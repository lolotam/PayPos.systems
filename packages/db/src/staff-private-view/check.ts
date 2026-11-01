import { sql } from 'drizzle-orm';

import type { AuthDatabase } from '../auth-database.ts';
import { staffPrivateViewIdentifier } from './identifiers.ts';
import { timestamp, toDate } from './timestamp.ts';

/** طلب فحص نافذة: الحدود محسوبة من عينة ساعة واحدة في auth. */
export type StaffPrivateViewCheckRequest = {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly windowId: string;
  /** عينة الساعة الواحدة اللي اتحسبت منها الحدود. */
  readonly now: Date;
  /** أقل تاريخ مسموح بيه للّمسة الأخيرة قبل ما الخمول يصرف النافذة. */
  readonly idleFloor: Date;
  /** أقل تاريخ مسموح بيه لبداية النافذة قبل ما السقف يصرفها. */
  readonly capFloor: Date;
};

/** نتيجة الفحص: مرور مع بداية النافذة، أو انتهاء، أو اختلاف. */
export type StaffPrivateViewCheckOutcome =
  | { readonly kind: 'passed'; readonly createdAt: Date }
  | { readonly kind: 'expired' }
  | { readonly kind: 'mismatch' };

/**
 * يتحقق ويلمس في عبارة واحدة؛ شرط window_id يمنع طلب قديم من تمديد نافذة أحدث.
 * ولما اللمسة ماتفعش، الحذف بيتقفل بمفتاح النافذة نفسه عشان الطلب القديم مايمسحش صف أحدث.
 *
 * @param database واجهة pospay_auth
 * @param request قيم الطلب وحدود الخمول والسقف
 * @returns المرور وبداية النافذة، أو انتهاء، أو اختلاف ما بيغيرش التخزين
 */
export async function checkStaffPrivateView(
  database: AuthDatabase,
  request: StaffPrivateViewCheckRequest,
): Promise<StaffPrivateViewCheckOutcome> {
  const identifier = staffPrivateViewIdentifier(request.sessionId);
  const [passed] = await database.db.execute<{ created_at: Date | string }>(sql`
    UPDATE verification SET updated_at=${timestamp(request.now)}
    WHERE identifier=${identifier}
      AND value::jsonb->>'window_id'=${request.windowId}
      AND value::jsonb->>'user_id'=${request.userId}
      AND value::jsonb->>'device_id'=${request.deviceId}
      AND updated_at>=${timestamp(request.idleFloor)} AND created_at>=${timestamp(request.capFloor)} AND created_at<=${timestamp(request.now)}
      AND EXISTS (SELECT 1 FROM session s
                  WHERE s.id=${request.sessionId}::uuid AND s.user_id=${request.userId}::uuid
                    AND s.purpose='STAFF_POS' AND s.staff_absolute_deadline>${timestamp(request.now)})
    RETURNING created_at`);
  if (passed !== undefined) {
    return { kind: 'passed', createdAt: toDate(passed.created_at) };
  }
  const deleted = await database.db.execute<{ id: string }>(sql`
    DELETE FROM verification WHERE identifier=${identifier} AND value::jsonb->>'window_id'=${request.windowId}
      AND (updated_at<${timestamp(request.idleFloor)} OR created_at<${timestamp(request.capFloor)}) RETURNING id`);
  return deleted.length > 0 ? { kind: 'expired' } : { kind: 'mismatch' };
}
