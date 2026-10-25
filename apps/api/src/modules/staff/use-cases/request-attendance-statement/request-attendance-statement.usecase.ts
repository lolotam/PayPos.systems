import {
  ATTENDANCE_STATEMENT_DOCUMENT_KIND,
  type AttendanceStatementRequest,
} from '@pospay/contracts';
import { hasAttendanceStatementCoverage } from '@pospay/domain';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type { RateLimiter } from '../../../../shared/ports/rate-limiter.port.ts';
import {
  statementFilename,
  statementPeriodIsValid,
  statementShiftPair,
} from '../../domain/attendance-statement-request.ts';
import { AttendanceStatementError } from '../../domain/errors.ts';
import type {
  AttendanceStatementTransactions,
  DocumentRenderTransport,
} from '../../ports/attendance-statement.port.ts';
export { AttendanceStatementError } from '../../domain/errors.ts';

// يسجل طلب كشف الحضور المؤهل ثم يرسل معرفه للعامل بعد نجاح المعاملة.
export class RequestAttendanceStatementUseCase {
  constructor(
    private readonly transactions: AttendanceStatementTransactions,
    private readonly transport: DocumentRenderTransport,
    private readonly rateLimiter: RateLimiter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute({
    companyId,
    userId,
    businessId,
    branchId,
    input,
  }: {
    companyId: string;
    userId: string;
    businessId: string;
    branchId: string;
    input: AttendanceStatementRequest;
  }): Promise<{ render_id: string }> {
    await this.admitRender(companyId, userId);
    const now = this.clock.now();
    const renderId = this.ids.newId();
    const period = { from: input.from, to: input.to };
    // معرّف الموظفة بيوصل بحروف كبيرة من العميل، والداتابيز بترجّعه صغيرة؛ بنطبّعه مرة واحدة هنا.
    const employeeId = input.employee_id?.toLowerCase();
    await this.transactions.run({ companyId, userId, businessId, branchId }, async (ctx) => {
      const branch = await ctx.branch();
      if (branch === null) throw new AttendanceStatementError('BRANCH_NOT_FOUND');
      if (input.shift !== undefined && input.form === 'EMPLOYEE')
        throw new AttendanceStatementError('SHIFT_FILTER_INVALID');
      if (!statementPeriodIsValid(input.from, input.to, now, branch.timezone))
        throw new AttendanceStatementError('PERIOD_INVALID');
      const pair = statementShiftPair(input.shift);
      if (employeeId !== undefined) {
        const inputs = await ctx.employeeInputs(employeeId, period);
        if (
          inputs === null ||
          !hasAttendanceStatementCoverage(inputs, period, now.toISOString(), pair)
        )
          throw new AttendanceStatementError('EMPLOYEE_NOT_FOUND');
      }
      const logoFileId = await ctx.logo.read(businessId);
      await ctx.insert({
        id: renderId,
        companyId,
        businessId,
        branchId,
        form: input.form,
        employeeId: employeeId ?? null,
        from: input.from,
        to: input.to,
        language: input.language,
        shift: pair,
        logoFileId,
        requestedBy: userId,
        requestedAt: now,
      });
    });
    await this.enqueue(companyId, userId, renderId, input);
    return { render_id: renderId };
  }

  private async admitRender(companyId: string, userId: string): Promise<void> {
    if (!(await this.transport.rendererAlive()))
      throw new AttendanceStatementError('RENDERER_UNAVAILABLE');
    const allowed = await this.rateLimiter.hit(
      `attendance-statement:${companyId}:${userId}`,
      20,
      3600,
    );
    if (!allowed) throw new AttendanceStatementError('RATE_LIMITED');
  }

  private async enqueue(
    companyId: string,
    userId: string,
    renderId: string,
    input: AttendanceStatementRequest,
  ): Promise<void> {
    try {
      await this.transport.queue({
        companyId,
        renderId,
        kind: ATTENDANCE_STATEMENT_DOCUMENT_KIND,
        requestedBy: userId,
        filename: statementFilename(input.form, input.from, input.to),
      });
    } catch {
      await this.transport.markFailed(companyId, renderId).catch(() => undefined);
      throw new AttendanceStatementError('RENDERER_UNAVAILABLE');
    }
  }
}
