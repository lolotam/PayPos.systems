import type { AuthDatabase } from '@pospay/db';

import type { StaffDeviceContext } from './staff-otp/types.ts';
import type { SessionRow } from './staff-sessions.ts';

/** الجلسة لم تعد الجلسة الحية لهذا الجهاز. */
export class StaffSessionEnded extends Error {
  override readonly name = 'StaffSessionEnded';
}

/** هوية الجلسة المحمولة إلى معاملة الكتابة؛ ليست مطالبة يرسلها العميل. */
export interface StaffSessionProof {
  readonly sessionId: string;
  readonly userId: string;
  readonly deadline: Date;
  readonly device: StaffDeviceContext;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * نفس نص قفل تدوير جلسة الجهاز. تغييره يفصل تسجيل الخروج عن انتظار الساعة.
 *
 * @param deviceId الجهاز المثبت
 * @returns مفتاح القفل الاستشاري
 */
export function staffDeviceSessionLockKey(deviceId: string): string {
  return `pospay:staff-session:v1:${deviceId}`;
}

/**
 * يحذف الجلسة تحت قفل الجهاز حتى ينتظر الخروج المتزامن أو يسبقه.
 *
 * @param database اتصال الاعتماد
 * @param sessionId معرّف الجلسة الحية
 * @param deviceId الجهاز المثبت
 */
export async function retireStaffSession(
  database: AuthDatabase,
  sessionId: string,
  deviceId: string,
): Promise<void> {
  if (!UUID.test(sessionId) || !UUID.test(deviceId)) return;
  const key = staffDeviceSessionLockKey(deviceId);
  await database.db.transaction(async (tx) => {
    await tx.execute(`SELECT pg_advisory_xact_lock(hashtextextended('${key}', 0))`);
    await tx.execute(
      `DELETE FROM session WHERE id = '${sessionId}'::uuid AND purpose = 'STAFF_POS'`,
    );
  });
}

/** يطبع صف الجلسة الذي يعيده محول الاعتماد، والتواريخ قد تصل نصاً. */
export function sessionFromRecord(value: unknown): SessionRow | null {
  if (value === null || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const expiresAt = asDate(row.expiresAt);
  if (typeof row.id !== 'string' || typeof row.token !== 'string' || typeof row.userId !== 'string')
    return null;
  if (expiresAt === null) return null;
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    expiresAt,
    purpose: typeof row.purpose === 'string' ? row.purpose : null,
    staffDeviceContext: row.staffDeviceContext,
    staffAuthenticatedAt: asDate(row.staffAuthenticatedAt),
    staffAbsoluteDeadline: asDate(row.staffAbsoluteDeadline),
  };
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
