import type { ServiceCategoryClosingFailure } from '../../domain/service-category-closing-job.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  ServiceCategoryClosingDiagnostics,
  ServiceCategoryClosingOutcome,
  ServiceCategoryClosingTransactions,
} from '../../ports/service-category-closing.port.ts';

/** يشغّل طلب قفل أو فتح تصنيف كبير ويكتب نتيجته على صف الطلب، ويوثّق الفشل برمز ثابت. */
export class RunServiceCategoryClosing {
  constructor(
    private readonly transactions: ServiceCategoryClosingTransactions,
    private readonly clock: Clock,
    private readonly diagnostics?: ServiceCategoryClosingDiagnostics,
  ) {}

  async execute(companyId: string, closingId: string): Promise<ServiceCategoryClosingOutcome> {
    const outcome = await this.transactions.run(companyId, closingId, () => this.clock.now());
    if (outcome.kind === 'failed') await this.report(companyId, closingId, outcome.code);
    return outcome;
  }

  async fail(
    companyId: string,
    closingId: string,
    code: ServiceCategoryClosingFailure,
  ): Promise<void> {
    await this.report(companyId, closingId, code);
    await this.transactions.fail(companyId, closingId, code, this.clock.now());
  }

  // قراءة الطالب للسجل فقط؛ تعثرها لا يغير قرار الفشل ولا يمنع كتابته.
  private async report(
    companyId: string,
    closingId: string,
    code: ServiceCategoryClosingFailure,
  ): Promise<void> {
    if (!this.diagnostics) return;
    const requestedBy = await this.transactions
      .readRequester(companyId, closingId)
      .catch(() => null);
    this.diagnostics.failed({ companyId, closingId, requestedBy, code });
  }
}
