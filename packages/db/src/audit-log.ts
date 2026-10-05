import { redactSecrets } from '@pospay/observability';
import { sql } from 'drizzle-orm';

import { toJsonb } from './outbox.ts';
import { assertUuid, type Tx } from './with-tenant.ts';

/**
 * تغيير حساس لازم يتسجل (CLAUDE.md §8): الحالة قبل وبعد، مين عمله، على أنهي كيان.
 */
export interface AuditEntry {
  /** snake_case: price, membership, payment… */
  readonly entity: string;
  readonly entityId: string;
  /** snake_case مع نقط مسموحة: created, price.changed… */
  readonly action: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * بيكتب صف في الـ audit_log جوه نفس transaction التغيير. الشركة والمستخدم بييجوا من الـ context
 * (app_company_id() و app_user_id()) مش من الـ caller، فمحدش يقدر يسجّل تغيير باسم حد تاني؛
 * لو مفيش مستخدم (job في الـ worker) الـ actor بيبقى NULL = النظام.
 * الـ before والـ after بيعدّوا على redactSecrets الأول: الصف ده بيفضل للأبد، فأي PIN أو token أو hash
 * جه بالغلط في snapshot بيتشال قبل ما يتكتب (CLAUDE.md §8). أرقام التليفون بتفضل زي ما هي.
 *
 * @param tx    transaction من withTenant أو withNewTenant
 * @param id    UUID v7 من الـ IdGenerator
 * @param entry التغيير
 * @returns بيخلص لما الصف يتكتب (لسه مش committed)
 */
export async function appendAuditLog(tx: Tx, id: string, entry: AuditEntry): Promise<void> {
  await appendAuditLogs(tx, [{ id, entry }]);
}

/**
 * يكتب تدقيق دفعة ذرية في أمر واحد بنفس تنقية الأسرار وهوية السياق المستخدمة للصف المفرد.
 *
 * @param tx معاملة الشركة
 * @param entries معرفات السجل والتغييرات المعتمدة
 * @returns يكتمل عند إدخال كل الصفوف داخل المعاملة
 */
export async function appendAuditLogs(
  tx: Tx,
  entries: readonly { id: string; entry: AuditEntry }[],
): Promise<void> {
  if (entries.length === 0) return;
  const json = (value: unknown, name: string): string | null =>
    value === undefined ? null : toJsonb(redactSecrets(value), name);
  const values = entries.map(({ id, entry }) => ({
    id: assertUuid(id, 'id'),
    entity: entry.entity,
    entity_id: assertUuid(entry.entityId, 'entityId'),
    action: entry.action,
    before: json(entry.before, 'before'),
    after: json(entry.after, 'after'),
  }));
  // صفوف JSONB تقلل معاملات البروتوكول دون تغيير التنقية أو هوية سياق المعاملة.
  await tx.execute(sql`
    INSERT INTO audit_log (company_id, id, actor_user_id, entity, entity_id, action, before, after)
    SELECT app_company_id(),id,app_user_id(),entity,entity_id,action,before::jsonb,after::jsonb
    FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb)
      AS r(id uuid,entity text,entity_id uuid,action text,before text,after text)`);
}
