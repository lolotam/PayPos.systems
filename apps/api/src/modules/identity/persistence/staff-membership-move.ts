import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';

import { StaffUserRefused } from '../domain/staff-access-errors.ts';
import { staffAccessSystemRole } from '../domain/staff-access-roles.ts';
import type { StaffAccessRole } from '../domain/staff-access-roles.ts';
import { systemRoleId } from './staff-user-auth.ts';

/**
 * ينقل عضوية الموظفة إلى فرعها الأساسي الجديد داخل معاملة staff نفسها (FR-F3-3، الاستثناء المحدود في
 * ADR-0063 D5): ينهي العضوية القديمة ويفتح عضوية فرع جديدة بنفس دور النظام. استثناءات الصلاحيات
 * (`permission_overrides`، سواء ALLOW أو DENY) تخص الفرع القديم فتبقى على العضوية القديمة وتنتهي معها
 * ولا تُنسخ أبداً (AC-F3-3). عضوية قديمة غير فعّالة تفشل الدالة فتتراجع معاملة تعديل الموظفة كلها.
 *
 * @param tx    معاملة الشركة التي فتحها use case تعديل الموظفة
 * @param input الشركة والعضوية القديمة وصاحبها والفرع الجديد ودور الدخول ومولّد المعرّفات ولحظة اختيارية
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
