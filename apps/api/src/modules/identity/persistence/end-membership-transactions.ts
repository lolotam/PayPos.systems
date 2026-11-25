import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  EndMembershipCommand,
  EndMembershipOutcome,
  EndMembershipTransactions,
} from '../ports/end-membership.port.ts';
import { authorityAllows } from './member-invitation-records.ts';

interface TargetRow extends Record<string, unknown> {
  id: string;
  user_id: string | null;
  starts_at: string | Date;
  ends_at: string | Date | null;
}

// التريجر المؤجّل 0013 بيرفض آخر مالك وقت الـ commit بـ P0001 وhint ثابت؛ الخطأ ممكن يكون ملفوف في cause.
function isLastOwnerRefusal(error: unknown): boolean {
  for (let node = error, depth = 0; typeof node === 'object' && node !== null && depth < 5; depth += 1) {
    const { code, hint, cause } = node as { code?: unknown; hint?: unknown; cause?: unknown };
    if (code === 'P0001' && hint === 'pospay:last-owner') return true;
    node = cause;
  }
  return false;
}

// onBeforeCommit بيمسكه اختبار السباق بس: بعد التعديل والتدقيق وقبل الـ commit اللي بيشغّل تريجر 0013.
export function createEndMembershipTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
  onBeforeCommit?: () => Promise<void>,
): EndMembershipTransactions {
  return {
    end: async (command, now) => {
      try {
        return await db.withTenant(
          command.companyId,
          (tx) => endInside(tx, command, now, ids, onBeforeCommit),
          { userId: command.actorUserId },
        );
      } catch (error) {
        if (isLastOwnerRefusal(error)) return { refusal: 'LAST_OWNER' };
        throw error;
      }
    },
  };
}

async function endInside(
  tx: Tx,
  command: EndMembershipCommand,
  now: Date,
  ids: IdGenerator,
  onBeforeCommit: (() => Promise<void>) | undefined,
): Promise<EndMembershipOutcome> {
  const { companyId, actorUserId, membershipId } = command;
  if (!(await authorityAllows(tx, companyId, actorUserId))) return { refusal: 'FORBIDDEN' };
  // قفل صف الهدف بس: قفل الشركة أو كل العضويات كان هيخلي مالك تاني يفقد سلطته قبل الفحص (403) بدل ما يوصل لتريجر 0013.
  const [row] = await tx.execute<TargetRow>(sql`
    SELECT id, user_id, starts_at, ends_at FROM memberships
    WHERE company_id = ${companyId} AND id = ${membershipId} FOR UPDATE`);
  if (row === undefined) return { refusal: 'NOT_FOUND' };
  if (!(await authorityAllows(tx, companyId, actorUserId))) return { refusal: 'FORBIDDEN' };
  const ownerFilter =
    row.user_id === null
      ? sql`membership_id = ${membershipId}`
      : sql`(membership_id = ${membershipId} OR user_id = ${row.user_id})`;
  const [staffManaged] = await tx.execute(sql`
    SELECT 1 FROM employee_staff_access
    WHERE company_id = ${companyId} AND ${ownerFilter}
    LIMIT 1`);
  if (staffManaged !== undefined) return { refusal: 'STAFF_ACCESS_MANAGED_MEMBERSHIP' };
  const previousEndsAt = row.ends_at === null ? null : new Date(row.ends_at);
  if (previousEndsAt !== null && previousEndsAt.getTime() <= now.getTime()) {
    return { id: row.id, endsAt: previousEndsAt.toISOString() };
  }
  // Postgres now() بيرجّع مايكروثانية، فلو الاستدعاء في نفس الملليثانية ممكن يكون now <= starts_at ويكسر قيد memberships_window.
  const startsAtMs = new Date(row.starts_at).getTime();
  const effectiveNow = now.getTime() > startsAtMs ? now : new Date(startsAtMs + 1);
  const endsAt = effectiveNow.toISOString();
  await tx.execute(sql`
    UPDATE memberships SET ends_at = ${endsAt}::timestamptz
    WHERE company_id = ${companyId} AND id = ${membershipId}`);
  await transactionWriters(tx, ids).audit.record({
    entity: 'membership',
    entityId: membershipId,
    action: 'membership.ended',
    before: { ends_at: previousEndsAt === null ? null : previousEndsAt.toISOString() },
    after: { ends_at: endsAt },
  });
  await onBeforeCommit?.();
  return { id: row.id, endsAt };
}
