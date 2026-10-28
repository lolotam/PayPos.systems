// التطبيق يكتب لحظة الرفض ووقت التحديث فقط؛ هوية العميل وبيانات الملف الشخصي وباقي الأعمدة محمية.
export const CUSTOMER_COLUMN_GRANTS = ['opted_out_at', 'updated_at'].map(
  (column) => `customers.${column}:pospay_app:UPDATE`,
);
