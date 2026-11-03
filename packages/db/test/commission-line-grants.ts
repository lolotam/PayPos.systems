// لقطة بنود العمولة قابلة للاستبدال بمراجعة أحدث؛ رؤوسها بلا DELETE، وصفوف الأنصبة تُحذف ضمن الاستبدال.
export const COMMISSION_LINE_TABLE_GRANTS = [
  'commission_line_heads:INSERT',
  'commission_line_heads:SELECT',
  'commission_line_heads:UPDATE',
  'commission_lines:DELETE',
  'commission_lines:INSERT',
  'commission_lines:SELECT',
  'commission_lines:UPDATE',
];
