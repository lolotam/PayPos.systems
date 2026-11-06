import { PackageImportError } from '../../domain/package-import.ts';
import { packagePreviewKey, packagePreviewRefs } from '../../domain/package-preview.ts';
import {
  parsePackageImportSheet,
  resolvePackageImportRows,
} from '../../domain/package-import-validation.ts';
import type {
  PackagePreviewClock,
  PackagePreviewTransactions,
  PackagePreviewWorkbook,
} from '../../ports/package-preview.port.ts';

/** فشل عابر آمن بلا cause؛ رسالة المزود أو معاملات SQL قد تحتوي هاتفًا أو مفتاح ملف. */
export class PackagePreviewRetryError extends Error {
  /**
   * يطلب إعادة المحاولة برمز ثابت لا يحمل أي بيانات مصدر.
   *
   * @param failureCode سبب آمن محفوظ عند تعذر تثبيت رفض دائم
   */
  constructor(readonly failureCode?: PackageImportError['code']) {
    super('PACKAGE_PREVIEW_RETRY');
    this.name = 'PackagePreviewRetryError';
  }
}

/** ينفذ معاينة الباقات؛ الحالة النهائية وحدها تحسم إعادة تسليم الحدث والمهمة. */
export class ExecutePackagePreview {
  /** يحقن معاملات المستأجر وقارئ المصنف والساعة من تركيب الوحدة. */
  constructor(
    private readonly transactions: PackagePreviewTransactions,
    private readonly workbook: PackagePreviewWorkbook,
    private readonly clock: PackagePreviewClock,
  ) {}

  /** يقرأ الملف خارج المعاملة ثم يحفظ صفوفًا آمنة؛ الخطأ العابر يحمل رمزًا فقط. */
  async execute(companyId: string, previewId: string): Promise<void> {
    try {
      const preview = await this.transactions.load(companyId, previewId);
      if (preview === null) return;
      const key = packagePreviewKey(preview, this.clock.now());
      const sheet = await this.workbook.read(key);
      await this.transactions.finish(companyId, previewId, async (scope) => {
        const current = scope.preview;
        if (current === null) return;
        packagePreviewKey(current, this.clock.now(), key);
        const refs = packagePreviewRefs(sheet.rows);
        const parsed = parsePackageImportSheet(
          sheet.rows,
          await scope.services(),
          await scope.existingRefs(refs),
        );
        const customers = await scope.findByPhones(parsed.rows.map((row) => row.phone));
        await scope.ready(
          sheet.rows.map(({ row }) => row),
          resolvePackageImportRows(parsed, customers),
        );
      });
    } catch (error) {
      if (error instanceof PackageImportError && error.code !== 'STORAGE_UNAVAILABLE') {
        await this.fail(companyId, previewId, error.code);
        return;
      }
      // استثناءات المزود وSQL ممكن تحمل هاتف أو مفتاح ملف؛ لا تخرج إلى سجلات BullMQ.
      throw new PackagePreviewRetryError();
    }
  }

  /** آخر محاولة تفشل pending فقط؛ لا تستبدل نتيجة عامل سبقها وتحفظ سبب الرفض الدائم عند تعذر الكتابة. */
  async fail(
    companyId: string,
    previewId: string,
    code: PackageImportError['code'] = 'STORAGE_UNAVAILABLE',
  ): Promise<void> {
    try {
      await this.transactions.fail(companyId, previewId, code);
    } catch {
      throw new PackagePreviewRetryError(code);
    }
  }
}
