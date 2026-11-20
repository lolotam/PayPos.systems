// جداول التصحيح: جيل التوليدات بيتعدّل في عمود واحد بس، وصفوف التصحيح نفسها للإدخال فقط.
export const COMMISSION_CORRECTION_TABLE_GRANTS = [
  'commission_corrections:INSERT',
  'commission_corrections:SELECT',
];

// جدول التصحيحات الموقوفة: قراءة على الجدول، والإدخال بالأعمدة المسموحة بس (من غير عمودا الحل
// عشان الصف يبقى مفتوح من أول لحظة)، ومن غير DELETE.
export const COMMISSION_BLOCKED_CORRECTION_TABLE_GRANTS = ['commission_blocked_corrections:SELECT'];

// إدخال صف موقوف: هوية الصف والشهور والرمز والحدث وكشف الهدف ووقت الإنشاء؛ الحل بييجي بالتعديل بعدين.
export const COMMISSION_BLOCKED_CORRECTION_INSERT_COLUMN_GRANTS = [
  'commission_blocked_corrections.company_id:pospay_app:INSERT',
  'commission_blocked_corrections.id:pospay_app:INSERT',
  'commission_blocked_corrections.business_id:pospay_app:INSERT',
  'commission_blocked_corrections.employee_id:pospay_app:INSERT',
  'commission_blocked_corrections.source_period:pospay_app:INSERT',
  'commission_blocked_corrections.code:pospay_app:INSERT',
  'commission_blocked_corrections.first_event_id:pospay_app:INSERT',
  'commission_blocked_corrections.target_period:pospay_app:INSERT',
  'commission_blocked_corrections.target_statement_id:pospay_app:INSERT',
  'commission_blocked_corrections.created_at:pospay_app:INSERT',
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
