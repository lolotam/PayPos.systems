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

export const PACKAGE_TYPE_COLUMN_GRANTS = [
  'package_types.name_ar:pospay_app:UPDATE',
  'package_types.name_en:pospay_app:UPDATE',
  'package_types.price:pospay_app:UPDATE',
  'package_types.revision:pospay_app:UPDATE',
  'package_types.updated_at:pospay_app:UPDATE',
  'package_types.validity_days:pospay_app:UPDATE',
];

// الهوية والنشاط وفرع الإنشاء ثابتة؛ المشاركة والإغلاق والاسمان والنسخة فقط قابلة للتحديث.
export const SERVICE_CATEGORY_COLUMN_GRANTS = [
  'service_categories.closed_at:pospay_app:UPDATE',
  'service_categories.name_ar:pospay_app:UPDATE',
  'service_categories.name_en:pospay_app:UPDATE',
  'service_categories.revision:pospay_app:UPDATE',
  'service_categories.updated_at:pospay_app:UPDATE',
  'service_categories.visibility:pospay_app:UPDATE',
];

// حالة الفرع ووقتها ونسختها فقط تتغير؛ الهوية والنشاط والفرع والتصنيف ثابتة ولا DELETE.
export const SERVICE_CATEGORY_BRANCH_SETTING_COLUMN_GRANTS = [
  'service_category_branch_settings.revision:pospay_app:UPDATE',
  'service_category_branch_settings.state:pospay_app:UPDATE',
  'service_category_branch_settings.updated_at:pospay_app:UPDATE',
];
