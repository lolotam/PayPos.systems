import {
  appendAuditLog,
  assertStatementPeriodsOpen,
  lockStatementPeriods,
  type IdGenerator,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { BusinessCalendarPort } from '../ports/business-calendar.port.ts';
import type { CommissionStatementGenerateScope } from '../ports/commission-statement.port.ts';
import type { CommissionStatementProviders } from '../ports/commission-statement-providers.port.ts';
import { readCommissionStatementSource } from './commission-statement-source.ts';

/** هوية الفاعل في إنشاء الكشف: الشركة والمستخدم والنشاط. */
export interface CommissionStatementGenerateActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

/** قراء الكاتب: تقويم النشاط، وفحص «الإنشاء والمراجعة»، ومزودو مصادر الكشف. */
export interface CommissionStatementGenerateReaders {
  readonly businessCalendar: BusinessCalendarPort['read'];
  readonly reviewAccess: (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ) => Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  readonly providers: CommissionStatementProviders;
}

/**
 * يبني خطوات الكتابة لإنشاء الكشف على معاملة الشركة: التوقيت، وقفل الشهر مع إنشاء صف DRAFT، وإعادة الفحص
 * بعد القفل، وقراءة المصادر، وتخزين بصمة المدخلات وحدها، والتدقيق.
 */
export function createCommissionStatementGenerateScope(
  tx: Tx,
  actor: CommissionStatementGenerateActor,
  ids: IdGenerator,
  readers: CommissionStatementGenerateReaders,
): CommissionStatementGenerateScope {
  let statementId: string | null = null;
  return {
    timeZone: async () =>
      (await readers.businessCalendar(tx, actor.companyId, actor.businessId))?.timeZone ?? null,
    lockPeriod: async (period) => {
      const locked = await lockStatementPeriods(tx, {
        businessId: actor.businessId,
        periods: [period],
        ids,
      });
      assertStatementPeriodsOpen(locked);
      statementId = locked[0]?.statementId ?? null;
    },
    recheckAccess: () =>
      readers.reviewAccess(tx, actor.companyId, actor.userId, actor.businessId),
    readSource: (period) =>
      readCommissionStatementSource(
        tx,
        { companyId: actor.companyId, businessId: actor.businessId, period },
        readers.providers,
      ),
    storeCurrentFingerprint: async (period, fingerprint) => {
      // البصمة وحدها: الحالة وبيانات المراجعة ما بتتلمسش، والمراجعة بتعيد قراءتها بنفسها (D-5، FR-029).
      await tx.execute(sql`UPDATE commission_statements SET current_fingerprint = ${fingerprint}
        WHERE company_id = app_company_id() AND business_id = ${actor.businessId}::uuid
          AND period = ${period}`);
    },
    audit: async (period, fingerprints) => {
      if (statementId === null) throw new Error('The statement was audited before it was locked');
      await appendAuditLog(tx, ids.newId(), {
        entity: 'commission_statement',
        entityId: statementId,
        action: 'commission_statement.generated',
        after: {
          period,
          input_fingerprint: fingerprints.input,
          statement_fingerprint: fingerprints.statement,
        },
      });
    },
  };
}
