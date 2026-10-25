// كشف العمولة يتغير عبر أعمدة الحالة والمراجعة فقط؛ هوية الشهر ودليل المعاملة بلا UPDATE للتطبيق.
export const COMMISSION_STATEMENT_COLUMN_GRANTS = [
  'status',
  'current_fingerprint',
  'reviewed_fingerprint',
  'reviewed_statement_fingerprint',
  'input_fingerprint',
  'statement_fingerprint',
  'reviewed_by',
  'reviewed_membership_id',
  'reviewed_at',
  'approved_by',
  'approved_at',
  'revision',
].map((column) => `commission_statements.${column}:pospay_app:UPDATE`);

// الجدولان المجمدان للإدخال فقط داخل معاملة الاعتماد، ولا حذف أو تعديل لأي جدول من الجداول الثلاثة.
export const COMMISSION_STATEMENT_TABLE_GRANTS = [
  'commission_statement_attachments:INSERT',
  'commission_statement_attachments:SELECT',
  'commission_statement_lines:INSERT',
  'commission_statement_lines:SELECT',
  'commission_statements:INSERT',
  'commission_statements:SELECT',
];
