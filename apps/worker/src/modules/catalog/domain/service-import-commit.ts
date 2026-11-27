/** الصف المطبّع كما حُفظ في المعاينة، بنفس شكل عقد ServiceImportRow وبرقم الصف الأصلي. */
export interface ServiceImportNormalizedRow {
  readonly row: number;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
  readonly category_name_en: string | null;
  readonly commission_rule:
    | { readonly kind: 'FOLLOW_PLAN' | 'ZERO' }
    | { readonly kind: 'PCT'; readonly value: number }
    | { readonly kind: 'FIXED'; readonly value: string };
  readonly counts_toward_threshold: boolean;
}

/** خدمة واحدة جاهزة للإدخال: فلوسها نص ثلاثي وقاعدتها موزّعة على أعمدة السجل. */
export interface ImportedServiceRecord {
  readonly id: string;
  readonly business_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
  readonly commission_rule_kind: 'FOLLOW_PLAN' | 'ZERO' | 'PCT' | 'FIXED';
  readonly commission_pct_bps: number | null;
  readonly commission_fixed_amount: string | null;
  readonly counts_toward_threshold: boolean;
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
  readonly created_at: string;
}

/** رفض التثبيت المسمّى؛ رمزه المستقر يُكتب على المعاينة بعد تراجع المعاملة كلها. */
export class ServiceImportCommitError extends Error {
  /**
   * يثبت رمز الفشل المستقر قبل أي كتابة حالة.
   *
   * @param code رمز الفشل المستقر من رموز حالة الاستيراد
   */
  constructor(
    readonly code:
      | 'IMPORT_PREVIEW_HAS_ERRORS'
      | 'IMPORT_PREVIEW_EXPIRED'
      | 'IMPORT_SERVICE_EXISTS'
      | 'IMPORT_CATEGORY_NOT_FOUND'
      | 'IMPORT_COMMIT_FAILED',
  ) {
    super(code);
    this.name = 'ServiceImportCommitError';
  }
}

/**
 * بيثبت أن الطلب المقبول لم ينته بعد: المقارنة بين لحظة الطلب المخزّنة ولحظة الانتهاء، والمساواة
 * انتهاء، وتأخّر التنفيذ لا يُبطل طلباً مقبولاً لأن ما يُقاس هو وقت الطلب لا وقت التنفيذ (FR-009).
 *
 * @param preview              المعاينة المقفولة من الصف المقفل
 * @param preview.requested_at لحظة قبول الطلب المخزّنة من الساعة المحقونة عند القبول
 * @param preview.expires_at   لحظة انتهاء صلاحية المعاينة بعد 24 ساعة من الإنشاء
 * @returns لا يُرجع قيمة؛ يرمي IMPORT_PREVIEW_EXPIRED عند انتهاء صلاحية الطلب
 */
export function requireServiceImportRequestLive(preview: {
  readonly requested_at: string;
  readonly expires_at: string;
}): void {
  if (new Date(preview.requested_at).getTime() >= new Date(preview.expires_at).getTime())
    throw new ServiceImportCommitError('IMPORT_PREVIEW_EXPIRED');
}

/**
 * بيجمع معرّفات التصنيفات المُحالة مطلّقة صاعدة بلا تكرار، فترتيب القفل FOR SHARE ثابت
 * وما فيهش deadlock بين التزامين متوازيين لنشاط واحد (FR-009).
 *
 * @param rows صفوف المعاينة المطبّعة
 * @returns معرّفات التصنيفات صاعدة
 */
export function serviceImportCategoryIds(
  rows: readonly { readonly category_id: string | null }[],
): readonly string[] {
  return [...new Set(rows.flatMap((row) => (row.category_id === null ? [] : [row.category_id])))].sort();
}

/** لقطة التدقيق اليدوي (SV-02): السجل الجديد كاملاً بلا قيمة سابقة، والمال نص وقاعدتها على السلك. */
export interface ImportedServiceAuditSnapshot {
  readonly id: string;
  readonly business_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
  readonly commission_rule:
    | { readonly kind: 'FOLLOW_PLAN' }
    | { readonly kind: 'ZERO' }
    | { readonly kind: 'PCT'; readonly value: number }
    | { readonly kind: 'FIXED'; readonly value: string };
  readonly counts_toward_threshold: boolean;
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
  readonly closed_at: null;
  readonly closed_by_category_id: null;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * يبني لقطة تدقيق الخدمة المستوردة بنفس شكل إنشاء الخدمة اليدوي في الكتالوج: السجل كاملاً
 * بعد إيداعه بلا `before`، والسعر نصه الثلاثي القانوني كما في المطبّع، فلا تحويل فلوس ثانٍ
 * يمرّ برقم جافاسكربت ولا يتغيّر شكل اللقطة عن اليدوي (072 FR-009).
 *
 * @param record الخدمة المبنية كما أُودعت
 * @returns لقطة التدقيق بعد
 */
export function importedServiceSnapshot(
  record: ImportedServiceRecord,
): ImportedServiceAuditSnapshot {
  return {
    id: record.id,
    business_id: record.business_id,
    name_en: record.name_en,
    name_ar: record.name_ar,
    price: record.price,
    commission_rule: ruleWire(record),
    counts_toward_threshold: record.counts_toward_threshold,
    duration_minutes: record.duration_minutes,
    category_id: record.category_id,
    closed_at: null,
    closed_by_category_id: null,
    revision: 1,
    created_at: record.created_at,
    updated_at: record.created_at,
  };
}

function ruleWire(
  record: ImportedServiceRecord,
): ImportedServiceAuditSnapshot['commission_rule'] {
  if (record.commission_rule_kind === 'PCT')
    return { kind: 'PCT', value: record.commission_pct_bps ?? 0 };
  if (record.commission_rule_kind === 'FIXED')
    return { kind: 'FIXED', value: record.commission_fixed_amount ?? '0.000' };
  return record.commission_rule_kind === 'ZERO' ? { kind: 'ZERO' } : { kind: 'FOLLOW_PLAN' };
}
