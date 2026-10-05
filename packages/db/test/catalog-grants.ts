// تعديل الخدمة يغيّر الاسم والسعر وقاعدة العمولة والراية والنسخة فقط؛ الهوية والنشاط غير قابلين للتحديث.
export const SERVICE_COLUMN_GRANTS = [
  'services.commission_fixed_amount:pospay_app:UPDATE',
  'services.commission_pct_bps:pospay_app:UPDATE',
  'services.commission_rule_kind:pospay_app:UPDATE',
  'services.counts_toward_threshold:pospay_app:UPDATE',
  'services.name_ar:pospay_app:UPDATE',
  'services.name_en:pospay_app:UPDATE',
  'services.price:pospay_app:UPDATE',
  'services.revision:pospay_app:UPDATE',
  'services.updated_at:pospay_app:UPDATE',
];
