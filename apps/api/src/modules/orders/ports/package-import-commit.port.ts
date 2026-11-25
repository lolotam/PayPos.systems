import type {
  PackageImportCommitActor,
  StoredPackageImportCommitPreview,
} from '../domain/package-import-commit.ts';

/** نطاق قبول التثبيت على معاملة واحدة: القراءة المقفلة، ثم تحويل الحالة وكتابة الحدث معاً. */
export interface PackageImportCommitScope {
  /**
   * يقرأ المعاينة المطلوبة تحت القفل نفسه الذي أخذه النطاق، ليقرر القرار على حالتها الحية.
   *
   * @param previewId هوية المعاينة المطلوب تثبيتها
   * @returns حقائق المعاينة أو null للمجهول والخارج عن الشركة
   */
  load(previewId: string): Promise<StoredPackageImportCommitPreview | null>;
  /**
   * ينقل المعاينة الجاهزة إلى commit_requested بعضوية القبول المثبتة، ويكتب حدث الطلب بهويتها
   * فقط في المعاملة نفسها، فلا يفترق طلب ضائع عن حدث ضائع.
   *
   * @param previewId هوية المعاينة الجاهزة
   * @param requestedAt لحظة الطلب المحقونة بصيغة ISO
   */
  request(previewId: string, requestedAt: string): Promise<void>;
}

/** حد المعاملة المستهلك من حالة استخدام تثبيت استيراد الباقات. */
export interface PackageImportCommitTransactions {
  /**
   * ينفذ قبول التثبيت تحت RLS وهوية صاحب الطلب: إذن حي وعضوية، ثم قفل المعاينة، ثم المفتاح المخزّن للرد.
   *
   * @param actor هوية الطلب ومفتاح التكرار وبصمته
   * @param work خطوات القبول داخل المعاملة
   * @returns رد القبول المخزّن، بعد COMMIT فقط
   */
  runCommit(
    actor: PackageImportCommitActor,
    work: (scope: PackageImportCommitScope) => Promise<{ preview_id: string }>,
  ): Promise<{ preview_id: string }>;
}
