import {
  appendAuditLog,
  appendOutboxEvent,
  assertStatementPeriodsOpen,
  lockStatementPeriods,
  type IdGenerator,
  type Tx,
} from '@pospay/db';
import { commissionStatementNoticeGroupSize } from '@pospay/contracts';
import { sql } from 'drizzle-orm';

import type { AlertRulesPort } from '../ports/alert-rules.port.ts';
import type {
  CommissionActorMembershipReader,
  CommissionApproversReader,
  CommissionStatementReviewScope,
} from '../ports/commission-statement-review.port.ts';
import type { CommissionStatementProviders } from '../ports/commission-statement-providers.port.ts';
import type { BusinessCalendarPort } from '../ports/business-calendar.port.ts';
import type { CommissionStatementReturnRecord } from '../domain/statement-return-plan.ts';
import type { CommissionStatementReviewTransition } from '../domain/statement-review-plan.ts';
import type { StatementFingerprints } from '../domain/statement-change-cause.ts';
import { groupStatementNoticeRecipients, statementNoticeRecipients } from '../domain/statement-notice.ts';
import { readCommissionStatementSource } from './commission-statement-source.ts';

/** هوية الفاعل في المراجعة والإرجاع: الشركة والمستخدم والنشاط. */
export interface CommissionStatementReviewActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

/** قراء الكاتب: تقويم النشاط، وفحص الصلاحية، ومزودو مصادر الكشف، والمستلمون والعضوية. */
export interface CommissionStatementReviewReaders {
  readonly businessCalendar: BusinessCalendarPort['read'];
  readonly reviewAccess: (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ) => Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  readonly returnAccess: (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ) => Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  readonly providers: CommissionStatementProviders;
  readonly actorMembership: CommissionActorMembershipReader;
  readonly approvers: CommissionApproversReader;
  readonly alertRules: AlertRulesPort;
}

/** كل ما steps الكتابة بتحتاجه: المعاملة، ومولّد المعرّفات، والقراء، والفاعل. */
export interface CommissionStatementReviewContext {
  readonly tx: Tx;
  readonly ids: IdGenerator;
  readonly readers: CommissionStatementReviewReaders;
  readonly actor: CommissionStatementReviewActor;
}

/**
 * يبني خطوات الكتابة للمراجعة أو الإرجاع على معاملة الشركة: التوقيت، وقفل الشهر، وإعادة الفحص
 * بعد القفل، وقراءة المصادر، وتخزين الحالة، والتدقيق، وإشعار الاعتماد.
 *
 * @param context المعاملة والمعرّفات والقراء والفاعل
 * @param kind نوع العملية: المراجعة أو الإرجاع، وبه يتحدد فحص الصلاحية
 * @returns خطوات الكتابة
 */
export function createCommissionStatementReviewScope(
  context: CommissionStatementReviewContext,
  kind: 'review' | 'return',
): CommissionStatementReviewScope {
  const { tx, ids, readers, actor } = context;
  let statementId: string | null = null;
  const access = kind === 'review' ? readers.reviewAccess : readers.returnAccess;
  const locked = () => {
    if (statementId === null) throw new Error('The statement was used before it was locked');
    return statementId;
  };
  return {
    timeZone: async () =>
      (await readers.businessCalendar(tx, actor.companyId, actor.businessId))?.timeZone ?? null,
    lockPeriod: async (period) => {
      const rows = await lockStatementPeriods(tx, {
        businessId: actor.businessId,
        periods: [period],
        ids,
      });
      assertStatementPeriodsOpen(rows);
      statementId = rows[0]?.statementId ?? null;
    },
    lockedStatementId: locked,
    recheckAccess: () => access(tx, actor.companyId, actor.userId, actor.businessId),
    readSource: (period) =>
      readCommissionStatementSource(
        tx,
        { companyId: actor.companyId, businessId: actor.businessId, period },
        readers.providers,
      ),
    actorMembership: () => readers.actorMembership(tx, actor.companyId, actor.userId),
    storeReview: (period, transition) => storeReview(context, period, transition),
    storeReturn: (period, transition) => storeReturn(context, period, transition),
    storeReturnRecord: (record) => storeReturnRecord(context, record),
    auditReview: (period, fingerprints) => auditReview(context, locked(), period, fingerprints),
    auditReturn: (period) => auditReturn(context, locked(), period),
    notifyApprovers: (period, businessId) =>
      appendApprovalNotice(context, locked(), period, businessId),
  };
}

/** يخزّن حالة REVIEWED ببصمتيها والمراجع ووقته على صف الكشف المقفول. */
async function storeReview(
  context: CommissionStatementReviewContext,
  period: string,
  transition: CommissionStatementReviewTransition,
): Promise<void> {
  const { tx, actor } = context;
  await tx.execute(sql`UPDATE commission_statements SET status = 'REVIEWED',
    reviewed_fingerprint = ${transition.review.fingerprint},
    reviewed_statement_fingerprint = ${transition.review.statementFingerprint},
    reviewed_by = ${transition.review.actorUserId}::uuid,
    reviewed_membership_id = ${transition.review.actorMembershipId}::uuid,
    reviewed_at = ${transition.review.recordedAt.toISOString()}::timestamptz
    WHERE company_id = app_company_id() AND business_id = ${actor.businessId}::uuid
      AND id = ${transition.statementId}::uuid AND period = ${period}`);
}

/** يرجّع الكشف المراجَع لمسودة ويمسح حقائق المراجعة الخمس. */
async function storeReturn(
  context: CommissionStatementReviewContext,
  period: string,
  transition: { readonly statementId: string },
): Promise<void> {
  const { tx, actor } = context;
  await tx.execute(sql`UPDATE commission_statements SET status = 'DRAFT',
    reviewed_fingerprint = NULL, reviewed_statement_fingerprint = NULL,
    reviewed_by = NULL, reviewed_membership_id = NULL, reviewed_at = NULL
    WHERE company_id = app_company_id() AND business_id = ${actor.businessId}::uuid
      AND id = ${transition.statementId}::uuid AND period = ${period}`);
}

/** يكتب سطر الإرجاع بالسبب؛ السبب يعيش في السطر ده وحده (FR-031). */
async function storeReturnRecord(
  context: CommissionStatementReviewContext,
  record: CommissionStatementReturnRecord,
): Promise<void> {
  const { tx, ids, actor } = context;
  await tx.execute(sql`INSERT INTO commission_statement_returns(
    company_id, id, business_id, statement_id, returned_by, returned_membership_id, reason, created_at)
    VALUES (app_company_id(), ${ids.newId()}::uuid, ${actor.businessId}::uuid,
      ${record.statementId}::uuid, ${record.actorUserId}::uuid,
      ${record.actorMembershipId}::uuid, ${record.reason}, ${record.recordedAt.toISOString()}::timestamptz)`);
}

/** تدقيق المراجعة: البصمتان والشهر، من غير أي مبلغ ولا اسم. */
async function auditReview(
  context: CommissionStatementReviewContext,
  statementId: string,
  period: string,
  fingerprints: StatementFingerprints,
): Promise<void> {
  const { tx, ids } = context;
  await appendAuditLog(tx, ids.newId(), {
    entity: 'commission_statement',
    entityId: statementId,
    action: 'commission_statement.reviewed',
    after: {
      period,
      input_fingerprint: fingerprints.input,
      statement_fingerprint: fingerprints.statement,
    },
  });
}

/** تدقيق الإرجاع: الشهر بس؛ السبب مش بيدخل نص التدقيق (FR-031). */
async function auditReturn(
  context: CommissionStatementReviewContext,
  statementId: string,
  period: string,
): Promise<void> {
  const { tx, ids } = context;
  await appendAuditLog(tx, ids.newId(), {
    entity: 'commission_statement',
    entityId: statementId,
    action: 'commission_statement.returned',
    after: { period },
  });
}

/**
 * إشعار «الكشف مستني الاعتماد»: القاعدة بتحدد التشغيل والقناة بس، والمستلمون هم أصحاب صلاحية
 * الاعتماد اللي شايفين النشاط كله وقت الحدث (FR-030، DR-008، CS-Q52 = PP-227). الحدث بيتكتب في
 * نفس معاملة المراجعة، مجموعة لكل مية مستلم (ADR-0037 §5).
 */
async function appendApprovalNotice(
  context: CommissionStatementReviewContext,
  statementId: string,
  period: string,
  businessId: string,
): Promise<void> {
  const { tx, ids, readers, actor } = context;
  const rule = await readers.alertRules.rule(
    tx,
    actor.companyId,
    { businessId, branchId: null },
    'STATEMENT_AWAITING_APPROVAL',
  );
  if (!rule.enabled || !rule.channels.includes('IN_APP')) return;
  const holders = await readers.approvers(tx, actor.companyId, businessId);
  const groups = groupStatementNoticeRecipients(holders, commissionStatementNoticeGroupSize);
  for (const [index, group] of groups.entries()) {
    await appendOutboxEvent(tx, ids.newId(), {
      aggregateType: 'commission_statement',
      aggregateId: statementId,
      eventType: 'StatementAwaitingApproval',
      payload: {
        schema_version: 1,
        business_id: businessId,
        statement_id: statementId,
        period,
        group_index: index,
        notification_recipients: statementNoticeRecipients(group, period),
      },
    });
  }
}
