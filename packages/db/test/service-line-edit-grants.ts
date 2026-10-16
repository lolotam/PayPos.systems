// تعديل سعر البند يمس الأعمدة السبعة فقط؛ بقية السطر تبقى كما سُجّلت.
export const SERVICE_LINE_EDIT_COLUMN_GRANTS = [
  'service_lines.discount:pospay_app:UPDATE',
  'service_lines.effective_discount_bps:pospay_app:UPDATE',
  'service_lines.limit_bps_applied:pospay_app:UPDATE',
  'service_lines.limit_source:pospay_app:UPDATE',
  'service_lines.net:pospay_app:UPDATE',
  'service_lines.price:pospay_app:UPDATE',
  'service_lines.revision:pospay_app:UPDATE',
];
