import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { OverrideTerms } from '../domain/permission-edit.ts';

/** قرار محفوظ على عضوية: معرّفه وأثره ونهاية مدته. */
export interface SavedDecision extends Record<string, unknown> {
  readonly id: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly expires_at: string | null;
}

/**
 * القرارات السارية على نفس المفتاح، مقفولة، عشان المستبدل ينهي القديم بدل ما يتكدّس.
 *
 * @param tx           معاملة الشركة
 * @param companyId    الشركة
 * @param membershipId العضوية المستهدفة
 * @param terms        شروط الاستثناء
 * @param now          وقت المعاملة
 * @returns القرارات السارية على نفس المفتاح
 */
export async function currentOverrides(
  tx: Tx,
  companyId: string,
  membershipId: string,
  terms: OverrideTerms,
  now: Date,
): Promise<readonly SavedDecision[]> {
  const rows = await tx.execute<SavedDecision>(sql`
    SELECT id, effect, to_json(expires_at) #>> '{}' AS expires_at FROM permission_overrides
    WHERE company_id = ${companyId} AND membership_id = ${membershipId}
      AND permission_code = ${terms.permission_code} AND scope_type = ${terms.scope_type}
      AND scope_id = ${terms.scope_id}
      AND (expires_at IS NULL OR expires_at > ${now.toISOString()}::timestamptz)
    ORDER BY id FOR UPDATE`);
  return Array.from(rows);
}

/**
 * كتابة الاستثناء: إنهاء القديم ثم إضافة الجديد مع تدقيق «ممنوح» أو «مستبدل».
 *
 * @param tx           معاملة الشركة
 * @param ids          مولّد المعرّفات
 * @param input        الشركة والمنحّ
 * @param input.companyId الشركة
 * @param input.actorUserId صاحب المنح
 * @param membershipId العضوية اللي اتكتب عليها الاستثناء
 * @param terms        شروط الاستثناء
 * @param previous     القرارات السابقة على نفس المفتاح
 * @param now          وقت المعاملة
 */
export async function writeOverride(
  tx: Tx,
  ids: IdGenerator,
  input: { readonly companyId: string; readonly actorUserId: string },
  membershipId: string,
  terms: OverrideTerms,
  previous: readonly SavedDecision[],
  now: Date,
): Promise<void> {
  for (const row of previous) {
    await tx.execute(sql`
      UPDATE permission_overrides SET expires_at = ${now.toISOString()}::timestamptz
      WHERE company_id = ${input.companyId} AND id = ${row.id}`);
  }
  const id = ids.newId();
  await tx.execute(sql`
    INSERT INTO permission_overrides
      (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason,
       granted_by, granted_at, expires_at)
    VALUES (${input.companyId}, ${id}, ${membershipId}, ${terms.permission_code}, ${terms.effect},
      ${terms.scope_type}, ${terms.scope_id}, ${terms.reason}, ${input.actorUserId},
      ${now.toISOString()}::timestamptz, ${terms.expires_at}::timestamptz)`);
  await transactionWriters(tx, ids).audit.record({
    entity: 'permission_override',
    entityId: id,
    action: previous.length === 0 ? 'permission.granted' : 'permission.replaced',
    before:
      previous.length === 0
        ? null
        : previous.map((row) => ({ ...row, membership_id: membershipId })),
    after: { ...terms, membership_id: membershipId },
  });
}
