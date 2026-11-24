import type { Tx } from '@pospay/db';

import {
  readEmployeeDetailAccess,
  readStaffAccessAuthority,
  readStaffAccessState,
  readStaffUser,
} from '../../identity/index.ts';
import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';

/**
 * قراءات شاشة دخول الموظفة: بوابة قراءة الموظفة عبر identity's `readEmployeeDetailAccess` (P1-1)،
 * والحالة والسلطة على معاملة المستدعِ بلا أقفال كتابة، وحساب الدخول عبر packages/auth —
 * سهم staff → identity المعلن (plan §2.2).
 *
 * @param auth واجهة حساب الموظفة عبر identity
 * @returns القراءات الأربع للاستعلام
 */
export function createEmployeeAccessStateReads(auth: AuthFacadeForStaffAccess) {
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
  };
}
