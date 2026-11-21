// منح جدول مبيعات العمولة: قراءة وإدخال فقط، والتعديل محصور في أعمدة الحدث المشتقّة.
export const COMMISSION_SALES_TABLE_GRANTS = [
  'commission_sales:INSERT',
  'commission_sales:SELECT',
];

// هوية الشركة والبيع والنشاط وهوية الصف ما بتتعدلش، وما فيش DELETE: البيع المالي بيتبدل بمراجعة أحدث بس.
export const COMMISSION_SALES_COLUMN_GRANTS = [
  ...['branch_id', 'seller_employee_id', 'business_date', 'period', 'price_paid', 'refunded_amount', 'status', 'revision'].map(
    (column) => `commission_sales.${column}:pospay_app:UPDATE`,
  ),
];
