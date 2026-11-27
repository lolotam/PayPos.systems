import type { StaffAccessStateRow } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  readEmployeeDetailAccess,
  readStaffAccessAuthority,
  readStaffAccessOwner,
  readStaffAccessState,
  readStaffUser,
} from '../../identity/index.ts';
import { pendingStaffAccessCancellable, staffAccessCancelAllowed } from '../domain/staff-access.ts';
import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';

/**
 * سلطة «إعطاء الدخول» على كل فرع للموظفة: الأساسي وفروعها الإضافية (080-b) — مدير السالمية
 * لوحده ما يقدرش يدير موظفة شغالة على حولي كمان.
 */
async function readMultiBranchAuthority(
  tx: Tx,
  input: {
    companyId: string;
    actorUserId: string;
    businessId: string;
    branchId: string;
    employeeId?: string | undefined;
  },
): Promise<boolean> {
  if (!(await readStaffAccessAuthority(tx, input))) return false;
  if (input.employeeId === undefined) return true;
  const extras = await tx.execute<{ branch_id: string }>(sql`
    SELECT DISTINCT b.branch_id
    FROM employee_staff_access_branches b
    JOIN employee_staff_access a ON a.company_id = b.company_id AND a.id = b.access_id
    WHERE b.company_id = ${input.companyId}
      AND b.employee_id = ${input.employeeId}
      AND a.state <> 'STOPPED'`);
  for (const extra of extras) {
    if (!(await readStaffAccessAuthority(tx, { ...input, branchId: extra.branch_id }))) {
      return false;
    }
  }
  return true;
}

/**
 * قراءات شاشة دخول الموظفة: بوابة قراءة الموظفة عبر identity's `readEmployeeDetailAccess` (P1-1)،
 * والحالة والسلطة على معاملة المستدعِ بلا أقفال كتابة، وحساب الدخول عبر packages/auth —
 * سهم staff → identity المعلن (plan §2.2). وقاعدة الإلغاء (المانح أو المالك، وبعد 24 ساعة)
 * من الـ domain، والمُنفّذة هنا عشان طبقة الاستعلام ما تستوردرش من الـ domain.
 *
 * @param auth واجهة حساب الموظفة عبر identity
 * @returns القراءات للاستعلام
 */
export function createEmployeeAccessStateReads(auth: AuthFacadeForStaffAccess) {
  const actorIsOwner = (
    tx: Tx,
    input: { companyId: string; actorUserId: string },
  ): Promise<boolean> => readStaffAccessOwner(tx, input);
  return {
    state: (tx: Tx, input: { companyId: string; businessId: string; employeeId: string }) =>
      readStaffAccessState(tx, input),
    readAccess: (
      tx: Tx,
      input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
    ) =>
      readEmployeeDetailAccess(
        tx,
        input.companyId,
        input.actorUserId,
        input.businessId,
        input.branchId,
      ),
    // سلطة «إعطاء الدخول» على كل فرع للموظفة: الأساسي وفروعها الإضافية (080-b).
    authority: (tx: Tx, input: Parameters<typeof readMultiBranchAuthority>[1]) =>
      readMultiBranchAuthority(tx, input),
    staffUser: (operationId: string) => readStaffUser(auth, operationId),
    actorIsOwner,
    cancelAllowed: async (
      tx: Tx,
      input: { companyId: string; actorUserId: string; record: StaffAccessStateRow['record'] },
    ): Promise<boolean> => {
      const record = input.record;
      if (record === null) return false;
      if (!pendingStaffAccessCancellable(record, record.now)) return false;
      // قراءة عضوية المالك ما بتتعملش إلا لما السجل قابل للإلغاء والفاعل مش هو المانح الأصلي.
      const owner =
        record.grantedBy === input.actorUserId
          ? false
          : await actorIsOwner(tx, {
              companyId: input.companyId,
              actorUserId: input.actorUserId,
            });
      return staffAccessCancelAllowed(record, input.actorUserId, owner);
    },
  };
}

/**
 * فحص سلطة «إعطاء الدخول» داخل معاملة كتابة الموظف (079-c1 / GR-001): ضبط أو تغيير إيميل
 * الاستعادة مش مسموح إلا للي يملك `manage:staff-access:branch` على الفرع الأساسي.
 */
export function canManageStaffAccess(
  tx: Tx,
  input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
): Promise<boolean> {
  return readStaffAccessAuthority(tx, input);
}
