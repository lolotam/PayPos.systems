// قبول الطلب والوظيفة يعدّلان حالة الاستيراد فقط؛ صفوف المعاينة وأخطاؤها تبقى كما حُسبت (ADR-0034).
export const IMPORT_COLUMN_GRANTS = [
  'import_previews.committed_at:pospay_app:UPDATE',
  'import_previews.created_count:pospay_app:UPDATE',
  'import_previews.error_code:pospay_app:UPDATE',
  'import_previews.requested_at:pospay_app:UPDATE',
  'import_previews.status:pospay_app:UPDATE',
];
