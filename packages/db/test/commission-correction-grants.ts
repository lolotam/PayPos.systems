// جداول التصحيح: جيل التوليدات بيتعدّل في عمود واحد بس، وصفوف التصحيح نفسها للإدخال فقط.
export const COMMISSION_CORRECTION_TABLE_GRANTS = [
  'commission_corrections:INSERT',
  'commission_corrections:SELECT',
];

export const COMMISSION_PERIOD_GENERATION_TABLE_GRANTS = [
  'commission_period_generations:INSERT',
  'commission_period_generations:SELECT',
];

// العدّاد هو الحقل الوحيد القابل للتعديل في صف التوليد؛ أي تعديل تاني كان هيرفض الداتابيز.
export const COMMISSION_CORRECTION_COLUMN_GRANTS = [
  'commission_period_generations.generation:pospay_app:UPDATE',
];
