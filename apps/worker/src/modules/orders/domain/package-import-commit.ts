import { allocatePackagePrice, parseMoney } from '@pospay/domain';
import type { PackageImportCandidate } from './package-import.ts';

/** رفض دائم وآمن يسمح للعامل بإنهاء الطلب بعد التراجع عن المعاملة. */
export class PackageCommitError extends Error {
  /** يحتفظ برمز الرفض فقط دون بيانات المصدر أو تفاصيل قاعدة البيانات.
   *
   * @param code رمز رفض آمن دون تفاصيل المصدر */
  constructor(
    readonly code:
      | 'IMPORT_PREVIEW_EXPIRED'
      | 'IMPORT_PREVIEW_HAS_ERRORS'
      | 'IMPORT_COMMIT_FAILED'
      | 'IMPORT_SERVICE_NOT_FOUND',
  ) {
    super(code);
  }
}
/** المعاينة المخزنة بهوية قبول ثابتة وإثبات تقسيم صفوف المصدر. */
export interface PackageCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly commit_membership_id: string | null;
  readonly requested_at: string | null;
  readonly expires_at: string;
  readonly row_count: number;
  readonly error_count: number;
  readonly skipped_count: number;
  readonly source_rows: readonly number[] | null;
  readonly skipped_rows: readonly number[] | null;
  readonly rows: readonly PackageImportCandidate[];
  readonly errors: readonly unknown[];
}
/**
 * يحفظ الإثبات والأموال دون إعادة تفويض أو قراءة المصدر.
 *
 * @param preview المعاينة المقبولة وإثبات صفوفها وأموالها المجمدة
 * @returns صفوف التثبيت مرتبة بالمرجع مع موضع المصدر الكثيف
 */
export function packageCommitRows(preview: PackageCommitPreview) {
  const fail = () => {
    throw new PackageCommitError('IMPORT_COMMIT_FAILED');
  };
  if (preview.source_rows === null || preview.skipped_rows === null)
    throw new PackageCommitError('IMPORT_PREVIEW_EXPIRED');
  if (preview.errors.length !== 0 || preview.error_count !== 0)
    throw new PackageCommitError('IMPORT_PREVIEW_HAS_ERRORS');
  if (preview.commit_membership_id === null) fail();
  const requested = Date.parse(preview.requested_at ?? '');
  const expires = Date.parse(preview.expires_at);
  if (!Number.isFinite(requested) || !Number.isFinite(expires) || requested >= expires)
    throw new PackageCommitError('IMPORT_PREVIEW_EXPIRED');
  const source = [...preview.source_rows].sort((a, b) => a - b);
  const skipped = preview.skipped_rows;
  const partition = [...preview.rows.map((r) => r.row), ...skipped];
  if (
    source.length !== preview.row_count ||
    source.length > 500 ||
    skipped.length !== preview.skipped_count ||
    new Set(source).size !== source.length ||
    new Set(partition).size !== partition.length ||
    partition.length !== source.length ||
    source.some((n) => !Number.isInteger(n) || n < 2 || n > 502) ||
    partition.some((n) => !source.includes(n)) ||
    new Set(preview.rows.map((r) => r.external_ref)).size !== preview.rows.length
  )
    fail();
  return preview.rows
    .map((row) => {
      validateFrozenAllocation(row);
      return { ...row, import_row: source.indexOf(row.row) + 1 };
    })
    .sort((a, b) =>
      a.external_ref < b.external_ref ? -1 : a.external_ref > b.external_ref ? 1 : 0,
    );
}
/** يحسب ملخص التثبيت دون تعديل أعداد التخطي في إثبات المعاينة.
 *
 * @param rowCount عدد صفوف المصدر الفعلية
 * @param createdCount عدد الباقات المنشأة فعلياً
 * @returns أعداد الإنشاء والتخطي النهائية */
export function packageCommitCounts(rowCount: number, createdCount: number) {
  return { created_count: createdCount, skipped_count: rowCount - createdCount };
}

/** يحسب الباقات المنشأة من نتائج الإدراج دون احتساب تعارضات المراجع.
 *
 * @param outcomes نتائج الإدراج الفعلية للصفوف المؤهلة، بحد أقصى 500 نتيجة
 * @returns عدد الباقات التي فازت بالإدراج
 */
export function countCreatedPackageImports(outcomes: readonly boolean[]): number {
  return outcomes.filter((created) => created).length;
}

/** يتحقق من تطابق توزيع السعر مع القيم المجمدة لكل مكون وجلسة.
 *
 * @param row القيمة المجمدة المطلوب التحقق منها
 */
function validateFrozenAllocation(row: PackageImportCandidate) {
  const fail = () => {
    throw new PackageCommitError('IMPORT_COMMIT_FAILED');
  };
  try {
    const values = allocatePackagePrice(
      parseMoney(row.price_paid),
      row.components.map((c) => ({
        serviceId: c.service_id,
        sessions: c.sessions,
        remainingSessions: c.remaining,
        listPriceSnapshot: parseMoney(c.list_price_snapshot),
      })),
      'session-count',
    );
    values.forEach((v, i) => {
      const frozen = row.components[i];
      if (
        frozen === undefined ||
        v.sessionValues === undefined ||
        v.componentValue !== parseMoney(frozen.component_value) ||
        v.sessionValues.base !== parseMoney(frozen.base_unit_value) ||
        v.sessionValues.last !== parseMoney(frozen.last_unit_value)
      )
        fail();
    });
  } catch {
    fail();
  }
}
