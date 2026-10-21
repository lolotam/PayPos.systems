// قاعدة التنبيه بتتعدّل في أعمدتها بس؛ الشركة والنشاط والفرع والنوع ثابتين بعد الإدخال (spec 060 D-B13).
export const ALERT_RULE_COLUMN_GRANTS = [
  'channels',
  'delay_minutes',
  'enabled',
  'lead_minutes',
  'recipient_roles',
  'revision',
  'updated_at',
  'updated_by',
].map((column) => `alert_rules.${column}:pospay_app:UPDATE`);
