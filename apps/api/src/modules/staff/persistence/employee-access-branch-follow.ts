import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import { moveStaffMembershipToBranch, type StaffAccessRole } from '../../identity/index.ts';

type AccessRow = {
  id: string;
  state: string;
  role_code: StaffAccessRole;
  branch_id: string;
  user_id: string | null;
  membership_id: string | null;
};

/**
 * يتبع دخول الموظفة فرعها الأساسي الجديد (FR-F3-3): لو سجل دخولها ACTIVE تُنقل عضويتها إلى الفرع
 * الجديد بنفس الدور وتُحدَّث بياناتها في السجل، كله داخل معاملة تعديل الموظفة فأي فشل يتراجع معها.
 * سجل غير ACTIVE أو غائب لا يتغير شيء فيه؛ PENDING وCANCELLING مرفوضان قبل الحفظ (AC-ACT-12).
 *
 * @param tx         معاملة الشركة التي فتحها use case تعديل الموظفة
 * @param input      الشركة والموظفة والفرع الأساسي الجديد ومولّد المعرّفات
 * @returns معرّفا العضويتين القديمة والجديدة لإبطال كاش المنح بعد الالتزام، أو null بلا نقل
 */
export async function followPrimaryBranch(
  tx: Tx,
  input: { companyId: string; employeeId: string; branchId: string; ids: IdGenerator },
): Promise<{ oldMembershipId: string; newMembershipId: string } | null> {
  const [access] = await tx.execute<AccessRow>(sql`SELECT id,state,role_code,branch_id,user_id,membership_id
    FROM employee_staff_access
    WHERE company_id=${input.companyId} AND employee_id=${input.employeeId} FOR UPDATE`);
  if (access === undefined || access.state !== 'ACTIVE') return null;
  if (access.user_id === null || access.membership_id === null)
    throw new Error('STAFF_ACCESS_MEMBERSHIP_MISSING');
  const moved = await moveStaffMembershipToBranch(tx, {
    companyId: input.companyId,
    oldMembershipId: access.membership_id,
    userId: access.user_id,
    branchId: input.branchId,
    role: access.role_code,
    ids: input.ids,
  });
  await tx.execute(sql`UPDATE employee_staff_access
    SET branch_id=${input.branchId},membership_id=${moved.membershipId},updated_at=now()
    WHERE company_id=${input.companyId} AND id=${access.id}`);
  await transactionWriters(tx, input.ids).audit.record({
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
  return { oldMembershipId: access.membership_id, newMembershipId: moved.membershipId };
}
