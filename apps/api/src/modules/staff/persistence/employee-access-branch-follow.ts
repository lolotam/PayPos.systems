import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import {
  endExtraStaffMembership,
  moveStaffMembershipToBranch,
  type StaffAccessRole,
} from '../../identity/index.ts';

type AccessRow = {
  id: string;
  state: string;
  role_code: StaffAccessRole;
  branch_id: string;
  user_id: string | null;
  membership_id: string | null;
};

type ExtraBranchRow = {
  id: string;
  branch_id: string;
  role_code: StaffAccessRole;
  membership_id: string | null;
};

/**
 * يتبع دخول الموظفة فرعها الأساسي الجديد (FR-F3-3): لو سجل دخولها ACTIVE تُنقل عضويتها إلى الفرع
 * الجديد بنفس الدور وتُحدَّث بياناتها في السجل، كله داخل معاملة تعديل الموظفة فأي فشل يتراجع معها.
 * سجل غير ACTIVE أو غائب لا يتغير شيء فيه؛ PENDING وCANCELLING مرفوضان قبل الحفظ (AC-ACT-12).
 *
 * @param tx         معاملة الشركة التي فتحها use case تعديل الموظفة
 * @param input      الشركة والموظفة والفرع الأساسي الجديد ومولّد المعرّفات
 * @returns معرّفات العضويات المتأثرة لإبطال كاش المنح بعد الالتزام، أو null بلا نقل
 */
export async function followPrimaryBranch(
  tx: Tx,
  input: { companyId: string; employeeId: string; branchId: string; ids: IdGenerator },
): Promise<{ membershipIds: readonly string[] } | null> {
  const [access] = await tx.execute<AccessRow>(sql`SELECT id,state,role_code,branch_id,user_id,membership_id
    FROM employee_staff_access
    WHERE company_id=${input.companyId} AND employee_id=${input.employeeId} FOR UPDATE`);
  if (access === undefined) return null;
  const audit = transactionWriters(tx, input.ids).audit;
  // الفرع الجديد لو كان صف فرع إضافي بيتكرر: الصف بيتشال وعضويته بتتنهي (080-b).
  const duplicate = await duplicateExtraBranch(tx, input, access);
  const dropped =
    duplicate === undefined
      ? undefined
      : await dropDuplicateExtraBranch(tx, input, access, duplicate, audit);
  if (access.state !== 'ACTIVE') return null;
  if (access.user_id === null || access.membership_id === null)
    throw new Error('STAFF_ACCESS_MEMBERSHIP_MISSING');
  const moved = await moveStaffMembershipToBranch(tx, {
    companyId: input.companyId,
    oldMembershipId: access.membership_id,
    userId: access.user_id,
    branchId: input.branchId,
    role: access.role_code,
    ids: input.ids,
    ...(dropped?.membershipId === undefined ? {} : { mergedMembershipId: dropped.membershipId }),
  });
  await tx.execute(sql`UPDATE employee_staff_access
    SET branch_id=${input.branchId},membership_id=${moved.membershipId},updated_at=now()
    WHERE company_id=${input.companyId} AND id=${access.id}`);
  await audit.record({
    entity: 'employee_staff_access',
    entityId: access.id,
    action: 'branch_moved',
    before: { branch_id: access.branch_id, membership_id: access.membership_id },
    after: {
      employee_id: input.employeeId,
      branch_id: input.branchId,
      membership_id: moved.membershipId,
    },
  });
  return {
    membershipIds: [
      access.membership_id,
      moved.membershipId,
      ...(dropped?.membershipId === undefined ? [] : [dropped.membershipId]),
    ],
  };
}

/**
 * صف فرع إضافي على نفس الفرع الجديد: تكرار مع الفرع الأساسي بعد نقله (080-b).
 *
 * @param tx    معاملة الشركة
 * @param input الشركة والموظفة والفرع الأساسي الجديد
 * @param access سجل الدخول المقفول
 * @returns الصف المكرر أو null
 */
async function duplicateExtraBranch(
  tx: Tx,
  input: { companyId: string; employeeId: string; branchId: string },
  access: AccessRow,
): Promise<ExtraBranchRow | undefined> {
  const [row] = await tx.execute<ExtraBranchRow>(sql`
    SELECT id, branch_id, role_code, membership_id FROM employee_staff_access_branches
    WHERE company_id=${input.companyId} AND access_id=${access.id} AND branch_id=${input.branchId}
    FOR UPDATE`);
  return row;
}

/**
 * يتشمل الصف المكرر وعضويته بتتنهي لو كانت سارية (080-b): الفرع بقى أساسي فالعضوية القديمة
 * بقت زيادة، وحدث الدمج بيتدقيق عشان يبان في سجل الموظفة.
 */
async function dropDuplicateExtraBranch(
  tx: Tx,
  input: { companyId: string; employeeId: string; branchId: string; ids: IdGenerator },
  access: AccessRow,
  duplicate: ExtraBranchRow,
  audit: ReturnType<typeof transactionWriters>['audit'],
): Promise<{ membershipId?: string }> {
  let membershipId: string | undefined;
  if (duplicate.membership_id !== null && access.user_id !== null) {
    const endedNow = await endExtraStaffMembership(tx, {
      companyId: input.companyId,
      membershipId: duplicate.membership_id,
      userId: access.user_id,
      ids: input.ids,
    });
    if (endedNow) membershipId = duplicate.membership_id;
  }
  await tx.execute(sql`DELETE FROM employee_staff_access_branches
    WHERE company_id=${input.companyId} AND id=${duplicate.id}`);
  await audit.record({
    entity: 'employee_staff_access_branch',
    entityId: duplicate.id,
    action: 'merged_into_primary',
    before: {
      branch_id: duplicate.branch_id,
      role_code: duplicate.role_code,
      membership_id: duplicate.membership_id,
    },
    after: { access_id: access.id, employee_id: input.employeeId, primary_branch_id: input.branchId },
  });
  return membershipId === undefined ? {} : { membershipId };
}
