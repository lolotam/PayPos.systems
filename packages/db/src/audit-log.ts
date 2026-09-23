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
  const json = (value: unknown, name: string) =>
    value === undefined ? sql`NULL` : sql`${toJsonb(redactSecrets(value), name)}::jsonb`;
  await tx.execute(sql`
    INSERT INTO audit_log (company_id, id, actor_user_id, entity, entity_id, action, before, after)
    VALUES (app_company_id(), ${assertUuid(id, 'id')}, app_user_id(), ${entry.entity},
            ${assertUuid(entry.entityId, 'entityId')}, ${entry.action},
            ${json(entry.before, 'before')}, ${json(entry.after, 'after')})`);
}
