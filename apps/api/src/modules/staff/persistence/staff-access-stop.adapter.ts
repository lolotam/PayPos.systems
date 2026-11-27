import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  deleteStaffUserSessions,
  endExtraStaffMembership,
  endStaffMembership,
} from '../../identity/index.ts';
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
import { lockCompanyRow, lockExtraBranchRows, lockRecordWithEmployee } from './staff-access-rows.ts';

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
      // الفروع الإضافية بتتقفل قبل أي تعديل عشان ما يتزاحمش الإيقاف مع منح متوازي (080-b).
      const extras = await lockExtraBranchRows(tx, actor.companyId, change.recordId);
      await endStaffMembership(tx, {
        companyId: actor.companyId,
        membershipId: change.membershipId,
        userId: change.userId,
        actorUserId: actor.userId,
        at: input.at,
        ids: input.ids,
      });
      const ended = await endExtraMemberships(tx, actor, input, change, extras);
      await tx.execute(sql`UPDATE employee_staff_access_branches SET membership_id=NULL
        WHERE company_id=${actor.companyId} AND access_id=${change.recordId}`);
      await tx.execute(sql`UPDATE employee_staff_access
        SET state='STOPPED',membership_id=NULL,updated_at=${input.at.toISOString()}::timestamptz
        WHERE company_id=${actor.companyId} AND id=${change.recordId}`);
      await transactionWriters(tx, input.ids).audit.record({
        entity: 'employee_staff_access',
        entityId: change.recordId,
        action: 'staff_access_stopped',
        after: { employee_id: input.employeeId, state: 'STOPPED' },
      });
      return { extraMembershipIds: ended };
    },
  };
}

/**
 * ينهي عضوية كل فرع إضافي ويفضّل `membership_id` بتاعه (080-b): العضوية المنتهية بتدقيق
 * «انتهت» والصف بيتدقيق «أُوقف» — فالسجل بيتقفل على الحالة الجديدة.
 */
async function endExtraMemberships(
  tx: Tx,
  actor: StaffAccessActor,
  input: StopInput,
  change: { recordId: string; userId: string },
  extras: readonly {
    readonly id: string;
    readonly branch_id: string;
    readonly role_code: string;
    readonly membership_id: string | null;
  }[],
): Promise<readonly string[]> {
  const audit = transactionWriters(tx, input.ids).audit;
  const ended: string[] = [];
  for (const extra of extras) {
    if (extra.membership_id === null) continue;
    const endedNow = await endExtraStaffMembership(tx, {
      companyId: actor.companyId,
      membershipId: extra.membership_id,
      userId: change.userId,
      ids: input.ids,
      at: input.at,
    });
    if (endedNow) ended.push(extra.membership_id);
    await audit.record({
      entity: 'employee_staff_access_branch',
      entityId: extra.id,
      action: 'stopped',
      before: { membership_id: extra.membership_id },
      after: {
        access_id: change.recordId,
        employee_id: input.employeeId,
        branch_id: extra.branch_id,
        role_code: extra.role_code,
        membership_id: null,
      },
    });
  }
  return ended;
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
