import {
  COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND,
  documentKindNeedsRenderer,
  type CommissionStatementExportRequest,
} from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { RateLimiter } from '../../../../shared/ports/rate-limiter.port.ts';
import {
  planStatementExportScope,
  statementExportFilename,
} from '../../domain/statement-export-scope.ts';
import type {
  StatementExportTransactions,
  StatementExportTransport,
} from '../../ports/statement-export.port.ts';
import { StatementExportError } from '../statement-export-error.ts';

/** الحالات اللي الكشف بيتصدّر فيها بعد الاعتماد بس (CS-Q10). */
const EXPORTABLE_STATUSES: ReadonlySet<string> = new Set(['APPROVED', 'PAID']);

/** حد الطلبات لكل مستخدم وشركة في الساعة؛ نفس سقف كشف الحضور. */
const REQUESTS_PER_HOUR = 20;

/** مدخلات الطلب: الهوية من الجلسة، والنشاط والشهر من المسار، واللغة من الجسم. */
export interface RequestStatementExportInput {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly input: CommissionStatementExportRequest;
}

// يسجّل طلب تصدير كشف شهر معتمد بنطاق الطالب ولغته، وبعد نجاح المعاملة يبعت معرّفه للعامل (FR-050).
export class RequestStatementExportUseCase {
  constructor(
    private readonly transactions: StatementExportTransactions,
    private readonly transport: StatementExportTransport,
    private readonly rateLimiter: RateLimiter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(request: RequestStatementExportInput): Promise<{ render_id: string }> {
    const { companyId, userId, businessId, period, input } = request;
    await this.admit(companyId, userId);
    const requestedAt = this.clock.now();
    const rowId = this.ids.newId();
    const renderId = this.ids.newId();
    await this.transactions.request({ companyId, userId, businessId }, async (context) => {
      const reader = await context.reader();
      if (reader.kind === 'forbidden') throw new StatementExportError('FORBIDDEN');
      if (reader.kind === 'feature_disabled') throw new StatementExportError('FEATURE_DISABLED');
      const statement = await context.statement(period);
      if (statement === null || !EXPORTABLE_STATUSES.has(statement.status))
        throw new StatementExportError('NOT_APPROVED');
      const employees = await context.frozenEmployees(statement.id);
      const requestedMembershipId = await context.requesterMembership();
      if (requestedMembershipId === null) throw new StatementExportError('FORBIDDEN');
      await context.insert({
        id: rowId,
        renderId,
        businessId,
        statementId: statement.id,
        period,
        requestedBy: userId,
        requestedMembershipId,
        scope: planStatementExportScope(reader, employees),
        language: input.language,
        requestedAt,
      });
    });
    await this.enqueue(companyId, userId, renderId, period);
    return { render_id: renderId };
  }

  // نوع bytes ما بيعدّيش على Chromium، فنبض عامل الـ PDF مش شرط قبوله.
  private async admit(companyId: string, userId: string): Promise<void> {
    if (
      documentKindNeedsRenderer(COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND) &&
      !(await this.transport.rendererAlive())
    )
      throw new StatementExportError('TRANSPORT_UNAVAILABLE');
    const allowed = await this.rateLimiter.hit(
      `commission-statement-export:${companyId}:${userId}`,
      REQUESTS_PER_HOUR,
      3600,
    );
    if (!allowed) throw new StatementExportError('RATE_LIMITED');
  }

  private async enqueue(
    companyId: string,
    userId: string,
    renderId: string,
    period: string,
  ): Promise<void> {
    try {
      await this.transport.queue({
        companyId,
        renderId,
        kind: COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND,
        requestedBy: userId,
        filename: statementExportFilename(period),
      });
    } catch {
      const failed = await this.transport.markFailed(companyId, renderId).catch(() => true);
      if (!failed) return;
      throw new StatementExportError('TRANSPORT_UNAVAILABLE');
    }
  }
}
