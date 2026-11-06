// العامل يملأ نتائج الباقات عند الخروج من pending فقط؛ trigger يمنع تغيير نتائج الموظفين أو معاينة جاهزة (ADR-0034، 47-1a).
export const IMPORT_COLUMN_GRANTS = [
  'import_previews.committed_at:pospay_app:UPDATE',
  'import_previews.created_count:pospay_app:UPDATE',
  'import_previews.error_code:pospay_app:UPDATE',
  'import_previews.error_count:pospay_app:UPDATE',
  'import_previews.errors:pospay_app:UPDATE',
  'import_previews.row_count:pospay_app:UPDATE',
  'import_previews.rows:pospay_app:UPDATE',
  'import_previews.skipped_count:pospay_app:UPDATE',
  'import_previews.skipped_rows:pospay_app:UPDATE',
  'import_previews.source_rows:pospay_app:UPDATE',
  'import_previews.requested_at:pospay_app:UPDATE',
  'import_previews.status:pospay_app:UPDATE',
];
