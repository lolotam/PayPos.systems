import {
  CUSTOMER_IMPORT_RECOVERY_MAX_PAGES,
  CustomerImportCommitError,
  customerImportCommitStaleBefore,
} from '../../domain/customer-import-commit.ts';
import type {
  CustomerImportCommitClock,
  CustomerImportCommitTransactions,
} from '../../ports/customer-import-commit.port.ts';

/** يثبت استيراد العملاء المقبول ذرياً وينهي الرفض الدائم بعد التراجع؛ الأخطاء المؤقتة تُعاد للطابور. */
export class CommitCustomerImport {
  constructor(
    private readonly transactions: CustomerImportCommitTransactions,
    private readonly clock: CustomerImportCommitClock,
  ) {}

  async execute(companyId: string, previewId: string): Promise<void> {
    try {
      await this.transactions.run(companyId, previewId, this.clock.now().toISOString());
    } catch (error) {
      if (error instanceof CustomerImportCommitError) {
        await this.transactions.fail(companyId, previewId, error.code);
        return;
      }
      throw error;
    }
  }

  /** يفوّض تثبيت الفشل النهائي بعد استنفاد المحاولات أو رفض الحدث. */
  fail(companyId: string, previewId: string, code = 'IMPORT_COMMIT_FAILED'): Promise<void> {
    return this.transactions.fail(companyId, previewId, code);
  }
}

/** يفشل الطلبات العالقة التي تجاوزت عمرها، بصفحات محدودة حتى لا يبتلع المسح العامل. */
export class RecoverCustomerImports {
  constructor(
    private readonly transactions: CustomerImportCommitTransactions,
    private readonly clock: CustomerImportCommitClock,
  ) {}

  async execute(companyId: string): Promise<void> {
    const before = customerImportCommitStaleBefore(this.clock.now().getTime());
    for (let page = 0; page < CUSTOMER_IMPORT_RECOVERY_MAX_PAGES; page++) {
      const failed = await this.transactions.failStalePage(companyId, before);
      if (failed === 0) return;
    }
  }
}
