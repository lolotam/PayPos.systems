import {
  businessToday,
  documentExpiryCandidate,
  recordExpiryOutcome,
  type ExpiryProgress,
} from '../../domain/document-expiry.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  DocumentExpiryCursor,
  DocumentExpiryRun,
  DocumentExpiryTransactions,
} from '../../ports/document-expiry.port.ts';

// TODO(spec) MO-Q3: حجم الصفحة غير محسوم؛ ١٠٠ مرشح لكل قراءة وكل الصفحات في الدورة (موصى به).
export const DOCUMENT_EXPIRY_PAGE_SIZE = 100;

/** يفحص وثائق شركة واحدة لكل نشاط بتوقيته: يسجل تنبيه انتهاء واحداً لكل وثيقة لكل تاريخ انتهاء. */
export class DetectDocumentExpiries {
  constructor(
    private readonly transactions: DocumentExpiryTransactions,
    private readonly clock: Clock,
  ) {}
  async execute(companyId: string): Promise<DocumentExpiryRun> {
    let progress: ExpiryProgress = { notified: 0, failed: 0 };
    // لحظة واحدة لكل دورة حتى لا يختلف اليوم المحلي بين صفحتين.
    const now = this.clock.now();
    let after: string | null = null;
    for (;;) {
      const page = await this.transactions.businesses(companyId, after, DOCUMENT_EXPIRY_PAGE_SIZE);
      for (const businessId of page)
        progress = await this.detectBusiness(companyId, businessId, now, progress);
      const last = page.at(-1);
      if (page.length < DOCUMENT_EXPIRY_PAGE_SIZE || last === undefined) break;
      after = last;
    }
    // وثيقة فشلت معاملتها لا توقف الباقي؛ الدورة كلها idempotent فيُعاد المحاولة بأمان.
    if (progress.failed > 0) throw new Error('DOCUMENT_EXPIRY_RETRY');
    return { notified: progress.notified };
  }

  private async detectBusiness(
    companyId: string,
    businessId: string,
    now: Date,
    progress: ExpiryProgress,
  ): Promise<ExpiryProgress> {
    const timeZone = await this.transactions.timeZone(companyId, businessId);
    const today = businessToday(now, timeZone);
    let after: DocumentExpiryCursor | null = null;
    for (;;) {
      const page = await this.transactions.candidates(
        companyId,
        businessId,
        timeZone,
        now,
        after,
        DOCUMENT_EXPIRY_PAGE_SIZE,
      );
      for (const candidate of page) {
        // حماية مضاعفة: نفس قاعدة SQL في domain، فلا يُكتب تنبيه لو انحرف الفلتر (parity).
        if (!documentExpiryCandidate(candidate.expiresOn, candidate.alertDays, today)) continue;
        const saved = await this.transactions
          .notify(companyId, candidate, today, now)
          .catch(() => null);
        progress = recordExpiryOutcome(progress, saved);
      }
      const last = page.at(-1);
      if (page.length < DOCUMENT_EXPIRY_PAGE_SIZE || last === undefined) break;
      after = { expiresOn: last.expiresOn, documentId: last.documentId };
    }
    return progress;
  }
}
