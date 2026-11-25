// جرد دوال استعادة جدولة التذكيرات (ADR-0061 §1) في ملف مستقل لإبقاء function-inventory.ts تحت حد الأسطر.
export const REMINDER_RECOVERY_FUNCTIONS = [
  {
    proname: 'recovery_company_ids',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
  },
  {
    proname: 'clear_reminder_schedules_lost_flag',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
  },
];
