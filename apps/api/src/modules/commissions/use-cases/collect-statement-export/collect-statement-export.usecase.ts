import { DOCUMENT_XLSX_MIME_TYPE } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import {
  statementExportFilename,
  statementExportStillCovered,
} from '../../domain/statement-export-scope.ts';
import type {
  StatementExportDocumentStore,
  StatementExportScopeIds,
  StatementExportTransactions,
} from '../../ports/statement-export.port.ts';
import { StatementExportError } from '../statement-export-error.ts';

/** طلب التحميل: الهوية والنشاط والشهر ومعرّف المستند. */
export interface CollectStatementExportInput extends StatementExportScopeIds {
  readonly period: string;
  readonly renderId: string;
}

/** الملف المسلّم: بايتاته ونوعه واسمه. */
export interface CollectStatementExportResult {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
}

// يسلّم ملف التصدير للطالب نفسه مرة واحدة بعد إعادة فحص صلاحيته، ويسجّل التحميل في نفس المعاملة (FR-050، FR-052).
export class CollectStatementExportUseCase {
  constructor(
    private readonly transactions: StatementExportTransactions,
    private readonly store: StatementExportDocumentStore,
    private readonly clock: Clock,
  ) {}

  async execute(input: CollectStatementExportInput): Promise<CollectStatementExportResult> {
    const { companyId, renderId, period } = input;
    const result = await this.transactions.collect(input, async (context) => {
      const row = await context.binding(renderId, period);
      if (row === null) throw new StatementExportError('NOT_FOUND');
      const status = await this.store.status(companyId, renderId);
      if (status === null || status.requestedBy !== input.userId)
        throw new StatementExportError('NOT_FOUND');
      if (row.collectedAt !== null) throw new StatementExportError('EXPIRED');
      const reader = await context.reader();
      const employees = await context.frozenEmployees(row.statementId);
      if (reader.kind !== 'scope' || !statementExportStillCovered(row.scope, reader, employees)) {
        // الصلاحية الحالية ما بقتش بتغطي النطاق المحفوظ أو الميزة اتقفلت: البايتات بتتمسح وبترجع FORBIDDEN موحّدة (CM-55e).
        await this.store.take(companyId, renderId);
        throw new StatementExportError('FORBIDDEN');
      }
      if (status.state === 'CONSUMED' || status.state === 'EXPIRED')
        throw new StatementExportError('EXPIRED');
      if (status.state !== 'READY') throw new StatementExportError('NOT_READY');
      const bytes = await this.store.take(companyId, renderId);
      if (bytes === null) throw new StatementExportError('EXPIRED');
      await context.audit.record({
        entity: 'commission_statement',
        entityId: row.statementId,
        action: 'commission_statement.exported',
        after: {
          export_id: row.id,
          render_id: renderId,
          business_id: row.businessId,
          period: row.period,
          scope: row.scope.kind,
          branch_ids: row.scope.kind === 'BRANCHES' ? row.scope.branchIds : null,
          language: row.language,
        },
      });
      await context.markCollected(row.id, this.clock.now());
      return {
        bytes,
        mimeType: DOCUMENT_XLSX_MIME_TYPE,
        filename: statementExportFilename(row.period),
      };
    });
    // بعد الـ commit: لو فشل التسجيل، الحالة بتفضل READY والبايتات راحت، فبتتقرا منتهية.
    await this.store.markConsumed(companyId, renderId).catch(() => undefined);
    return result;
  }
}
