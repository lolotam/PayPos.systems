// التطبيق يكتب لحظة الرفض ووقت التحديث وحقول الملف الشخصي فقط؛ هوية العميل وباقي الأعمدة محمية.
export const CUSTOMER_COLUMN_GRANTS = [
  'birth_day',
  'birth_month',
  'birth_year',
  'email',
  'gender',
  'opted_out_at',
  'updated_at',
].map((column) => `customers.${column}:pospay_app:UPDATE`);
