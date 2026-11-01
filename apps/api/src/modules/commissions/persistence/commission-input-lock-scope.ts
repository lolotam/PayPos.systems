import { lockStatementPeriods, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { BusinessCalendarPort } from '../ports/business-calendar.port.ts';
import type { CommissionPlanAccessPort } from '../ports/commission-plan-access.port.ts';
import type { CommissionInputLockScope } from '../ports/commission-input-lock-scope.port.ts';
import type { EmployeeRowLockPort } from '../ports/employee-row-lock.port.ts';

/** القارئ المشترك بين الكاتبين: تقويم النشاط وقفل الموظفة وإعادة فحص الصلاحية. */
export interface CommissionInputLockReaders {
  readonly businessCalendar: BusinessCalendarPort['read'];
  readonly employeeLock: EmployeeRowLockPort['lock'];
  readonly access: CommissionPlanAccessPort['recheck'];
}

/** هوية صاحب القفل: الشركة والنشاط والموظفة والمستخدم الفاعل. */
export interface CommissionInputLockActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly employeeId: string;
}

async function reopenReviewed(
  tx: Tx,
  actor: CommissionInputLockActor,
  periods: readonly string[],
): Promise<void> {
  if (periods.length === 0) return;
  await tx.execute(sql`UPDATE commission_statements SET status='DRAFT',
    reviewed_fingerprint=NULL,reviewed_statement_fingerprint=NULL,reviewed_by=NULL,
    reviewed_membership_id=NULL,reviewed_at=NULL
    WHERE company_id=${actor.companyId} AND business_id=${actor.businessId}
      AND status='REVIEWED' AND period IN (${sql.join(
        periods.map((period) => sql`${period}`),
        sql`, `,
      )})`);
}

/**
 * يبني خطوات القفل المشتركة على معاملة الكاتب: قفل الموظفة والتقويم والأشهر وإعادة الفحص.
 * الكتابة نفسها (إصدار أو تجاوز) بره، عشان كل كاتب يبقى مسؤول عن صفه.
 */
export function createCommissionInputLockScope(
  tx: Tx,
  actor: CommissionInputLockActor,
  ids: IdGenerator,
  readers: CommissionInputLockReaders,
): CommissionInputLockScope {
  return {
    lockEmployee: () =>
      readers.employeeLock(tx, actor.companyId, actor.businessId, actor.employeeId),
    calendar: () => readers.businessCalendar(tx, actor.companyId, actor.businessId),
    lockPeriods: (periods) =>
      lockStatementPeriods(tx, { businessId: actor.businessId, periods, ids }),
    reopenReviewed: (periods) => reopenReviewed(tx, actor, periods),
    recheckAccess: () => readers.access(tx, actor.companyId, actor.userId, actor.businessId),
  };
}
