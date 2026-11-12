// تقارير سجل إجازات الموظفين وصفوفها: إدخال وقراءة وحذف للتقرير، وإدخال وقراءة فقط للصفوف (D11).
export const LEAVE_HISTORY_REPORT_TABLE_GRANTS = [
  'leave_history_report_rows:INSERT',
  'leave_history_report_rows:SELECT',
  'leave_history_reports:DELETE',
  'leave_history_reports:INSERT',
  'leave_history_reports:SELECT',
];

// تعديل التقرير محصور في أعمدة النتيجة وحالة المعالجة؛ جسم الاستعلام والنطاق مجمدان.
export const LEAVE_HISTORY_REPORT_COLUMN_GRANTS = [
  'leave_history_reports.computed_at:pospay_app:UPDATE',
  'leave_history_reports.error_code:pospay_app:UPDATE',
  'leave_history_reports.row_count:pospay_app:UPDATE',
  'leave_history_reports.status:pospay_app:UPDATE',
];
