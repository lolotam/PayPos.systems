import type { IdGenerator } from '@pospay/db';
import type { Clock } from '../../ports/clock.port.ts';
import type { ServiceImportCommitTransactions } from '../../ports/service-import-commit.port.ts';
import type { ImportedServiceRecord } from '../../domain/service-import-commit.ts';
import {
  requireServiceImportRequestLive,
  serviceImportCategoryIds,
  ServiceImportCommitError,
} from '../../domain/service-import-commit.ts';

// طلب API هو نقطة التفويض؛ الوظيفة تنفذ الطلب المقبول وتعيد التحقق كله داخل معاملة واحدة:
// التحقق ثم القفل الاستشاري ثم القراءة الحاسمة ثم قفل التصنيفات ثم الإدخال والإتمام (FR-009).
export class CommitServiceImport {
  constructor(
    private readonly transactions: ServiceImportCommitTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** الفشل غير المتوقع بعد آخر محاولة: كتابة شرطية على الطلب الحي فقط برمز التثبيت الفاشل (FR-009). */
  fail(companyId: string, previewId: string): Promise<void> {
    return this.transactions.fail(companyId, previewId, 'IMPORT_COMMIT_FAILED');
  }

  async execute(companyId: string, previewId: string): Promise<void> {
    try {
      await this.transactions.run(companyId, previewId, async (scope) => {
        const preview = scope.preview;
        // إعادة التسليم بعد النجاح أو الفشل، ووظيفة كيان آخر، وتكرار وصول: تجاهل بلا كتابة (FR-009).
        if (preview === null) return;
        if (preview.error_count > 0) throw new ServiceImportCommitError('IMPORT_PREVIEW_HAS_ERRORS');
        requireServiceImportRequestLive(preview);
        if (!(await scope.businessExists(preview.business_id)))
          throw new ServiceImportCommitError('IMPORT_COMMIT_FAILED');
        await scope.lockImport(preview.business_id);
        const conflicts = await scope.existingNameKeys(
          preview.business_id,
          preview.rows.map((row) => row.name_en),
        );
        if (conflicts.length > 0) throw new ServiceImportCommitError('IMPORT_SERVICE_EXISTS');
        const locked = await scope.lockCategories(
          preview.business_id,
          serviceImportCategoryIds(preview.rows),
        );
        // تصنيف مفقود من النشاط أو مقفول بعد القبول، واحد أو أكثر، رفض التصنيف للصف كله (FR-009).
        for (const categoryId of serviceImportCategoryIds(preview.rows)) {
          const state = locked.get(categoryId);
          if (state === undefined || state.closed_at !== null)
            throw new ServiceImportCommitError('IMPORT_CATEGORY_NOT_FOUND');
        }
        const at = this.clock.now().toISOString();
        const records: ImportedServiceRecord[] = preview.rows.map((row) => ({
          id: this.ids.newId(),
          business_id: preview.business_id,
          name_en: row.name_en,
          name_ar: row.name_ar,
          price: row.price,
          commission_rule_kind: row.commission_rule.kind,
          commission_pct_bps: row.commission_rule.kind === 'PCT' ? row.commission_rule.value : null,
          commission_fixed_amount:
            row.commission_rule.kind === 'FIXED' ? row.commission_rule.value : null,
          counts_toward_threshold: row.counts_toward_threshold,
          duration_minutes: row.duration_minutes,
          category_id: row.category_id,
          created_at: at,
        }));
        await scope.insert(records);
        await scope.complete(preview, records.length, at);
      });
    } catch (error) {
      // الفشل المُسمّى فشل تحقق نهائي بعد تراجع المعاملة؛ وغير المتوقع يُعاد للطابور لمحاولاته (FR-009).
      if (error instanceof ServiceImportCommitError)
        await this.transactions.fail(companyId, previewId, error.code);
      else throw error;
    }
  }
}
