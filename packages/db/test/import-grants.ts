// الاستهلاك وحده يعدّل معاينة الاستيراد (committed_at)؛ بقية الأعمدة تبقى كما حُسبت (ADR-0034).
export const IMPORT_COLUMN_GRANTS = ['import_previews.committed_at:pospay_app:UPDATE'];
