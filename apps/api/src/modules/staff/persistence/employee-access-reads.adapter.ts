import type { StaffAccessStateRow } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

import {
  readEmployeeDetailAccess,
  readStaffAccessAuthority,
  readStaffAccessOwner,
  readStaffAccessState,
  readStaffUser,
} from '../../identity/index.ts';
import {
  pendingStaffAccessCancellable,
  staffAccessCancelAllowed,
} from '../domain/staff-access.ts';
import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';

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
  const actorIsOwner = (tx: Tx, input: { companyId: string; actorUserId: string }): Promise<boolean> =>
    readStaffAccessOwner(tx, input);
  return {
    state: (
      tx: Tx,
      input: { companyId: string; businessId: string; employeeId: string },
    ) => readStaffAccessState(tx, input),
    readAccess: (
      tx: Tx,
      input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
    ) => readEmployeeDetailAccess(tx, input.companyId, input.actorUserId, input.businessId, input.branchId),
    authority: (
      tx: Tx,
      input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
    ) => readStaffAccessAuthority(tx, input),
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
