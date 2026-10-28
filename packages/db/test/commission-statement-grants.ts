// كشف العمولة يتغير عبر أعمدة الحالة والمراجعة فقط؛ هوية الشهر ودليل المعاملة بلا UPDATE للتطبيق.
const COMMISSION_STATEMENT_COLUMNS = [
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
];

// صف طلب التصدير بيتجمّع مرة واحدة بس؛ فالتحديث الوحيد المسموح هو وقت التحميل.
const COMMISSION_STATEMENT_EXPORT_COLUMNS = ['collected_at'];

export const COMMISSION_STATEMENT_COLUMN_GRANTS = [
  ...COMMISSION_STATEMENT_COLUMNS.map(
    (column) => `commission_statements.${column}:pospay_app:UPDATE`,
  ),
  ...COMMISSION_STATEMENT_EXPORT_COLUMNS.map(
    (column) => `commission_statement_exports.${column}:pospay_app:UPDATE`,
  ),
];

// الجداول المجمّدة للإدخال فقط داخل معاملة الاعتماد، وصف التصدير بيتجمّع مرة واحدة؛ ولا حذف لأي منهم.
export const COMMISSION_STATEMENT_TABLE_GRANTS = [
  'commission_statement_attachments:INSERT',
  'commission_statement_attachments:SELECT',
  'commission_statement_exports:INSERT',
  'commission_statement_exports:SELECT',
  'commission_statement_lines:INSERT',
  'commission_statement_lines:SELECT',
  'commission_statements:INSERT',
  'commission_statements:SELECT',
];
