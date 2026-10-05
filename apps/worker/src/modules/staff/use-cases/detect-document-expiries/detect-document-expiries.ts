import { businessToday, documentExpiryCandidate } from '../../domain/document-expiry.ts';
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
    const run: DocumentExpiryRun = { notified: 0 };
    // لحظة واحدة لكل دورة حتى لا يختلف اليوم المحلي بين صفحتين.
    const now = this.clock.now();
    let failed = 0;
    for (const businessId of await this.transactions.businesses(companyId)) {
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
          if (saved === null) failed++;
          else if (saved) run.notified++;
        }
        const last = page.at(-1);
        if (page.length < DOCUMENT_EXPIRY_PAGE_SIZE || last === undefined) break;
        after = { expiresOn: last.expiresOn, documentId: last.documentId };
      }
    }
    // وثيقة فشلت معاملتها لا توقف الباقي؛ الدورة كلها idempotent فيُعاد المحاولة بأمان.
    if (failed > 0) throw new Error('DOCUMENT_EXPIRY_RETRY');
    return run;
  }
}
