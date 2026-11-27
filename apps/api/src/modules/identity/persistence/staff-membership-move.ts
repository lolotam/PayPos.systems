import { systemRolePolicy, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';

import { StaffUserRefused } from '../domain/staff-access-errors.ts';
import { shouldTransferOverrideOnBranchMove } from '../domain/inline-override-candidates.ts';
import { staffAccessSystemRole } from '../domain/staff-access-roles.ts';
import type { StaffAccessRole } from '../domain/staff-access-roles.ts';
import { systemRoleId } from './staff-user-auth.ts';

/** صف استثناء مرشّح للنقل مع تدقيقه. */
interface TransferredOverride extends Record<string, unknown> {
  readonly previous_membership_id: string;
  readonly id: string;
  readonly permission_code: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly scope_type: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scope_id: string;
  readonly expires_at: Date | null;
}

/**
 * ينقل عضوية الموظفة إلى فرعها الأساسي الجديد داخل معاملة staff نفسها (FR-F3-3، الاستثناء المحدود في
 * ADR-0063 D5): ينهي العضوية القديمة ويفتح عضوية فرع جديدة بنفس دور النظام.
 *
 * استثناءات الصلاحيات (`permission_overrides`): استثناءات الفرع على العضوية القديمة (نطاق BRANCH)
 * تخص الفرع القديم فتبقى عليها وتنتهي معها ولا تُنسخ أبداً (AC-F3-3)، بينما استثناءات المنع على
 * مستوى الشركة أو النشاط (نطاق COMPANY/BUSINESS) سارية وتغطي الفروع الإضافية اللي ما اتغيرتش،
 * فبتنتقل للعضوية الجديدة. استثناءات الفرع المدمج (اللي بقى أساسي) تنتقل كمان: المنع دائماً،
 * والسماح بس لو صلاحية الدور الجديد بتسمح بيها. الاستثناءات المنتهية (المنتهية مدتها) ما بتنتقلش
 * فالتاريخ ما يتغيرش، وكل استثناء انتقل بيتدفق `permission.transferred`.
 *
 * @param tx    معاملة الشركة التي فتحها use case تعديل الموظفة
 * @param input الشركة والعضوية القديمة وصاحبها والفرع الجديد ودور الدخول ومولّد المعرّفات ولحظة اختيارية وعضوية الفرع المدمج
 * @returns معرّف العضوية الجديدة
 */
export async function moveStaffMembershipToBranch(
  tx: Tx,
  input: {
    companyId: string;
    oldMembershipId: string;
    userId: string;
    branchId: string;
    role: StaffAccessRole;
    ids: IdGenerator;
    at?: Date;
    /** عضوية الفرع الإضافي المدمج عند نقله للأساسي — تنقل استثناءاتها السارية للعضوية الجديدة (080-b). */
    mergedMembershipId?: string | undefined;
  },
): Promise<{ membershipId: string }> {
  const at =
    input.at?.toISOString() ??
    String((await tx.execute<{ at: string }>(sql`SELECT clock_timestamp()::text AS at`))[0]?.at);
  const ended = await tx.execute(sql`UPDATE memberships SET ends_at=${at}::timestamptz
    WHERE company_id=${input.companyId} AND id=${input.oldMembershipId} AND user_id=${input.userId}
      AND (ends_at IS NULL OR ends_at > ${at}::timestamptz)
    RETURNING id`);
  if (ended.length === 0) throw new StaffUserRefused('STAFF_MEMBERSHIP_NOT_ACTIVE');
  const membershipId = input.ids.newId();
  await tx.execute(sql`INSERT INTO memberships
    (company_id,id,user_id,employee_id,role_id,role_owner_key,scope_type,scope_id,ends_at)
    VALUES (${input.companyId},${membershipId},${input.userId},NULL,
      ${systemRoleId(staffAccessSystemRole(input.role))}::uuid,'global','BRANCH',${input.branchId},NULL)`);
  const { audit } = transactionWriters(tx, input.ids);
  await transferActiveOverrides(tx, input, membershipId, at, audit);
  await audit.record({
    entity: 'membership',
    entityId: input.oldMembershipId,
    action: 'staff.membership_ended',
    before: { ends_at: null },
    after: { user_id: input.userId, ends_at: at },
  });
  await audit.record({
    entity: 'membership',
    entityId: membershipId,
    action: 'created',
    after: {
      user_id: input.userId,
      scope_type: 'BRANCH',
      scope_id: input.branchId,
      role: input.role,
    },
  });
  return { membershipId };
}

/**
 * الاستثناءات المرشّحة للنقل: كل السارية على العضويتين، وكل واحد بيتقيّم بقاعدة الـ domain
 * فيتحمل نقله أو لا.
 */
function transferableOverrides(
  candidates: readonly TransferredOverride[],
  input: { oldMembershipId: string },
  allowedPermissions: readonly string[],
  at: Date,
): TransferredOverride[] {
  return candidates.filter((row) =>
    shouldTransferOverrideOnBranchMove(
      {
        source:
          row.previous_membership_id === input.oldMembershipId ? 'old_primary' : 'merged_extra',
        effect: row.effect,
        scopeType: row.scope_type,
        permissionCode: row.permission_code,
        expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
      },
      allowedPermissions,
      at,
    ),
  );
}

/**
 * ينقل الاستثناءات السارية للعضوية الجديدة ويكتب تدقيق النقل: الاستثناءات على نطاق الشركة أو
 * النشاط بتنقل من العضوية القديمة (المنع بس — استثناءات الفرع بتخلص مع الفرع القديم)،
 * واستثناءات الفرع المدمج بتنقل كلها (المنع دايماً والسماح بس لو الدور الجديد يسمح). المنتهية
 * مدتها ما بتنتقلش. قاعدة الأهلية نفسها في الـ domain فتبقى واحدة مكانين.
 */
async function transferActiveOverrides(
  tx: Tx,
  input: {
    companyId: string;
    oldMembershipId: string;
    role: StaffAccessRole;
    mergedMembershipId?: string | undefined;
  },
  membershipId: string,
  at: string,
  audit: ReturnType<typeof transactionWriters>['audit'],
): Promise<void> {
  const allowedPermissions = [
    ...(systemRolePolicy(systemRoleId(staffAccessSystemRole(input.role)), 'global')?.permissions ??
      []),
  ];
  // القفل الأول بيجيب كل الاستثناءات السارية على العضويتين قبل التقييم، فما فيش سباق بين
  // القراءة وكتابة النقل.
  const candidates = await tx.execute<TransferredOverride>(sql`
    SELECT id, membership_id AS previous_membership_id, permission_code, effect, scope_type, scope_id,
      expires_at
    FROM permission_overrides
    WHERE company_id = ${input.companyId}
      AND (expires_at IS NULL OR expires_at > ${at}::timestamptz)
      AND (
        membership_id = ${input.oldMembershipId}
        OR ${input.mergedMembershipId === undefined ? sql`false` : sql`membership_id = ${input.mergedMembershipId}`}
      )
    FOR UPDATE`);
  const toMove = transferableOverrides(candidates, input, allowedPermissions, new Date(at));
  if (toMove.length === 0) return;
  await tx.execute(sql`
    UPDATE permission_overrides SET membership_id = ${membershipId}
    WHERE company_id = ${input.companyId} AND id IN (${sql.join(
      toMove.map((row) => sql`${row.id}`),
      sql`,`,
    )})`);
  for (const row of toMove)
    await audit.record({
      entity: 'permission_override',
      entityId: row.id,
      action: 'permission.transferred',
      before: { membership_id: row.previous_membership_id },
      after: {
        membership_id: membershipId,
        permission_code: row.permission_code,
        effect: row.effect,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
      },
    });
}
