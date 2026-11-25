import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { deleteStaffUserSessions, endStaffMembership } from '../../identity/index.ts';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  StaffAccessActor,
  StaffAccessIds,
  StaffAccessSessionEnder,
  StopEmployeeStaffAccessScope,
  StopEmployeeStaffAccessSteps,
} from '../ports/staff-access.port.ts';
import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';
import { staffAccessAuthority } from './staff-access-auth.adapter.ts';
import { lockCompanyRow, lockRecordWithEmployee } from './staff-access-rows.ts';

interface StopInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly ids: StaffAccessIds;
  readonly at: Date;
}

/** إنهاء جلسات الموظفة على pospay_auth عبر identity بعد التزام الإيقاف. */
export function createStaffAccessSessionEnder(
  auth: AuthFacadeForStaffAccess,
): StaffAccessSessionEnder {
  return { deleteSessions: (input) => deleteStaffUserSessions(auth, input) };
}

function stopScope(tx: Tx, actor: StaffAccessActor, input: StopInput): StopEmployeeStaffAccessScope {
  return {
    lockCompany: () => lockCompanyRow(tx, actor.companyId),
    lock: () => lockRecordWithEmployee(tx, actor.companyId, input),
    authority: staffAccessAuthority(tx, actor),
    stop: async (change) => {
      await endStaffMembership(tx, {
        companyId: actor.companyId,
        membershipId: change.membershipId,
        userId: change.userId,
        actorUserId: actor.userId,
        at: input.at,
        ids: input.ids,
      });
      await tx.execute(sql`UPDATE employee_staff_access
        SET state='STOPPED',membership_id=NULL,updated_at=${input.at.toISOString()}::timestamptz
        WHERE company_id=${actor.companyId} AND id=${change.recordId}`);
      await transactionWriters(tx, input.ids).audit.record({
        entity: 'employee_staff_access',
        entityId: change.recordId,
        action: 'staff_access_stopped',
        after: { employee_id: input.employeeId, state: 'STOPPED' },
      });
    },
  };
}

/**
 * يفتح معاملة «إيقاف الدخول» على pospay_app: العضوية والرقم السري والسجل والتدقيق في معاملة واحدة.
 *
 * @param database مغلفات الشركة من @pospay/db
 * @returns المنفذ الذي يشغّل الشغل داخل المعاملة
 */
export function createStopEmployeeStaffAccessSteps(
  database: TenantWrappers,
): StopEmployeeStaffAccessSteps {
  return {
    run: (actor, input, work) =>
      database.withTenant(actor.companyId, (tx) => work(stopScope(tx, actor, input)), {
        userId: actor.userId,
      }),
  };
}
