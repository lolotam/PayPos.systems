// جداول التصحيح: جيل التوليدات بيتعدّل في عمود واحد بس، وصفوف التصحيح نفسها للإدخال فقط.
export const COMMISSION_CORRECTION_TABLE_GRANTS = [
  'commission_corrections:INSERT',
  'commission_corrections:SELECT',
];

// جدول التصحيحات الموقوفة: قراءة وإدخال وتحديث محصور في الكود وعلامات الحل، ومن غير DELETE.
export const COMMISSION_BLOCKED_CORRECTION_TABLE_GRANTS = [
  'commission_blocked_corrections:INSERT',
  'commission_blocked_corrections:SELECT',
];

export const COMMISSION_PERIOD_GENERATION_TABLE_GRANTS = [
  'commission_period_generations:INSERT',
  'commission_period_generations:SELECT',
];

// العدّاد هو الحقل الوحيد القابل للتعديل في صف التوليد؛ أي تعديل تاني كان هيرفض الداتابيز.
export const COMMISSION_CORRECTION_COLUMN_GRANTS = [
  'commission_period_generations.generation:pospay_app:UPDATE',
];

// الكود وعلامات الحل هما المسموح تعديلهم في الصف الموقوف؛ الشهر المحتجز وكشفه محميان بالصلاحية والتريغر معاً.
export const COMMISSION_BLOCKED_CORRECTION_COLUMN_GRANTS = [
  'commission_blocked_corrections.code:pospay_app:UPDATE',
  'commission_blocked_corrections.resolved_at:pospay_app:UPDATE',
  'commission_blocked_corrections.resolved_generation:pospay_app:UPDATE',
];
