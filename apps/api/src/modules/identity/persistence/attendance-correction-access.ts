import { canonicalOwnerSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

/**
 * يحل منح correct:attendance:branch على فرع الجلسة، ويميز المالك النظامي عن أي تفويض شخصي.
 *
 * @param tx المعاملة الحالية
 * @param companyId الشركة
 * @param userId الفاعل المثبت
 * @param businessId النشاط المحلول من المسار
 * @param branchId فرع الجلسة المقفولة
 * @param now لحظة الساعة المحقونة لسريان العضوية
 * @returns هل الفرع داخل المنح، وهل العضوية السارية هي مالك الشركة
 */
export async function readAttendanceCorrectionAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  now: Date,
): Promise<{ allowed: boolean; owner: boolean }> {
  const access = await readAccessTransaction(tx, companyId, userId, now);
  const allowed = evaluateAccess(access.grants, 'correct:attendance:branch', {
    companyId,
    businessId,
    branchId,
    actorUserId: userId,
  });
  const at = sql`${now.toISOString()}::timestamptz`;
  const active = sql`m.starts_at <= ${at} AND (m.ends_at IS NULL OR m.ends_at > ${at})`;
  const [row] = await tx.execute<{ owner: boolean }>(sql`
    SELECT EXISTS(
      SELECT 1 FROM memberships m
      WHERE m.company_id=${companyId} AND m.user_id=${userId} AND ${active}
        AND ${canonicalOwnerSql('m', companyId)}
    ) AS owner`);
  // قرار المالك 2026-10-08 (CA-Q2): المالك هو الدور العالمي الثابت على الشركة، لا ALLOW شخصي.
  return { allowed, owner: row?.owner === true };
}
