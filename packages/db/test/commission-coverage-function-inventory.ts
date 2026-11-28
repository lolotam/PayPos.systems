// جرد دوال إثبات تغطية العمولات (ADR-0054 إضافة 2026-11-22) في ملف مستقل لإبقاء function-inventory.ts تحت حد الأسطر.
export const COMMISSION_COVERAGE_FUNCTIONS = [
  {
    proname: 'current_commission_coverage_generation',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
  },
  {
    proname: 'issue_commission_coverage_proof',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
  },
  {
    proname: 'read_commission_coverage_gate',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
  },
  {
    proname: 'invalidate_commission_coverage',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
  },
  {
    proname: 'commission_coverage_required_version',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'refuse_commission_coverage_change',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'refuse_counted_outbox_delete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'refuse_outbox_truncate',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
];
