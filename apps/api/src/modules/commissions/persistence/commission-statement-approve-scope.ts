import { appendAuditLog, lockStatementPeriods, type IdGenerator, type Tx } from '@pospay/db';
import { sessionBusinessDate } from '@pospay/domain';

import type { Clock } from '../../../shared/ports/clock.port.ts';
import type { BusinessCalendarPort } from '../ports/business-calendar.port.ts';
import type { CommissionStatementApproveScope } from '../ports/commission-statement-approve.port.ts';
import type { CommissionStatementProviders } from '../ports/commission-statement-providers.port.ts';
import type { EmployeeEmploymentPort } from '../ports/employee-employment.port.ts';
import type { PendingCommissionEventsPort } from '../ports/pending-commission-events.port.ts';
import { insertApprovalCarries, readApprovalLineShares } from './approval-carries.ts';
import { readApprovalCoverageGate, type ExplicitFeatureReader } from './approval-coverage-gate.ts';
import {
  freezeStatementRows,
  markStatementApproved,
  readApprovedAt,
  readFrozenStatement,
} from './approval-freeze.ts';
import { readCommissionStatementSource } from './commission-statement-source.ts';

/** هوية الفاعل في الاعتماد: الشركة والمستخدم والنشاط. */
export interface CommissionStatementApproveActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

/** قراء الاعتماد التي يربطها الجذر من الوحدات صاحبة البيانات، وساعة الخدمة. */
export interface CommissionStatementApproveReaders {
  readonly businessCalendar: BusinessCalendarPort['read'];
  readonly approveAccess: (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ) => Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  readonly explicitFeature: ExplicitFeatureReader;
  readonly employment: EmployeeEmploymentPort;
  readonly pending: PendingCommissionEventsPort;
  readonly providers: CommissionStatementProviders;
  readonly clock: Clock;
}

/**
 * يبني خطوات الاعتماد على معاملة الشركة بالترتيب الذي تستدعيه به حالة الاستخدام. لا قرار هنا: كل خطوة قراءة أو كتابة
 * واحدة، والقرارات (البوابة والبصمتان والمانعات والعدّاد) كلها في حالة الاستخدام.
 *
 * @param tx معاملة الاعتماد بسياق الشركة
 * @param actor الفاعل والنشاط
 * @param ids مولّد المعرّفات
 * @param readers القراء المربوطة من الجذر
 * @returns خطوات الاعتماد
 */
export function createCommissionStatementApproveScope(
  tx: Tx,
  actor: CommissionStatementApproveActor,
  ids: IdGenerator,
  readers: CommissionStatementApproveReaders,
): CommissionStatementApproveScope {
  const business = { userId: actor.userId, businessId: actor.businessId };
  return {
    cutoff: () => readers.pending.captureApprovalStart(tx),
    localToday: async () => {
      const calendar = await readers.businessCalendar(tx, actor.companyId, actor.businessId);
      return calendar === null ? null : sessionBusinessDate(readers.clock.now(), calendar.timeZone);
    },
    recheckAccess: () =>
      readers.approveAccess(tx, actor.companyId, actor.userId, actor.businessId),
    lockPeriods: (periods) =>
      lockStatementPeriods(tx, { businessId: actor.businessId, periods, ids }),
    readCoverageGate: () =>
      readApprovalCoverageGate(tx, actor.companyId, ids.newId(), readers.explicitFeature),
    readSource: (period) =>
      readCommissionStatementSource(
        tx,
        { companyId: actor.companyId, businessId: actor.businessId, period },
        readers.providers,
      ),
    readLineShares: (period) => readApprovalLineShares(tx, actor.businessId, period),
    countPendingEvents: async (cutoff) => Number(await readers.pending.pendingCount(tx, cutoff)),
    readEmployment: (employeeIds) =>
      readers.employment.employmentDates(tx, actor.companyId, actor.businessId, employeeIds),
    markApproved: (stamp) => markStatementApproved(tx, business, stamp),
    freeze: (statementId, rows, attachments) =>
      freezeStatementRows(tx, ids, business, statementId, rows, attachments),
    readFrozen: (statementId) => readFrozenStatement(tx, statementId),
    writeCarries: (statementId, period, carries) =>
      insertApprovalCarries(tx, ids, actor.businessId, statementId, period, carries),
    audit: (statementId, period, detail) =>
      appendAuditLog(tx, ids.newId(), {
        entity: 'commission_statement',
        entityId: statementId,
        action: 'commission_statement.approved',
        after: {
          period,
          input_fingerprint: detail.inputFingerprint,
          statement_fingerprint: detail.statementFingerprint,
          rows: detail.rows,
          carries: detail.carries,
        },
      }),
    readApprovedAt: async (statementId) => {
      const approvedAt = await readApprovedAt(tx, statementId);
      if (approvedAt === null) throw new Error('The approved statement has no approval time');
      return approvedAt;
    },
  };
}
