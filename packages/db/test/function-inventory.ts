import { COMMISSION_COVERAGE_FUNCTIONS } from './commission-coverage-function-inventory.ts';
import { REMINDER_RECOVERY_FUNCTIONS } from './reminder-recovery-function-inventory.ts';

export const FUNCTION_INVENTORY = [
  {
    proname: 'package_import_preview_partition_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_import_preview_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_redemptions_write_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'service_lines_redemption_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_redemption_validate_slot',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_redemption_validate',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_redemption_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_entitlements_extension_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_extensions_history_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  { proname: 'staff_columns_distinct', prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'] },
  {
    proname: 'orders_check_performers',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'orders_performer_consistency',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'initialize_attendance_state',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'employee_branches_close_once',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'enforce_passkey_installation_set_once',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  { proname: 'enforce_service_session_rating_request_day_set_once', prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'] },
  {
    proname: 'enforce_staff_otp_attempt',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'enforce_staff_otp_challenge',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'enforce_staff_session',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'invalidate_staff_phone_binding',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  { proname: 'app_company_id', prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'] },
  { proname: 'app_user_id', prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'] },
  {
    proname: 'assert_company_keeps_an_owner',
    prosecdef: false,
    proconfig: ['search_path=public, pg_temp'],
  },
  {
    proname: 'idempotency_keys_require_response',
    prosecdef: false,
    proconfig: ['search_path=public, pg_temp'],
  },
  {
    proname: 'in_app_notifications_guard',
    prosecdef: false,
    proconfig: ['search_path=public, pg_temp'],
  },
  {
    proname: 'notification_attempts_guard',
    prosecdef: false,
    proconfig: ['search_path=public, pg_temp'],
  },
  {
    proname: 'notification_email_destination_guard',
    prosecdef: false,
    proconfig: ['search_path=public, pg_temp'],
  },
  {
    proname: 'platform_email_is_suppressed',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'platform_whatsapp_is_suppressed',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'pospay_system_id',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'push_attempts_guard',
    prosecdef: false,
    proconfig: ['search_path=public, pg_temp'],
  },
  {
    // عدّاد الاعتماد (ADR-0012): definer يملكه pospay_approval_reader، والمسار والـ RLS مثبّتان في الدالة نفسها.
    proname: 'statement_pending_commission_events',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
  },
  // قراءة جهات اتصال تنبيهات الفريق (ADR-0003 §6a): definer يملكه pospay_team_contact_reader.
  { proname: 'team_alert_recipient_contacts', prosecdef: true, proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'] },
  {
    // استعادة جدولة التذكيرات (ADR-0061 §1): الدالتان definer، ومالك كل واحدة دور مالك دالة، والمسار مثبّت في الدالة نفسها.
    proname: 'sweep_expired_idempotency_keys',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'service_session_recoveries_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'line_performers_change_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'service_lines_performer_transition',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  { proname: 'slpc_begin', prosecdef: false, proconfig: ['search_path=pg_catalog, public, pg_temp'] },
  {
    proname: 'slpc_change_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  { proname: 'slpc_same_tuple', prosecdef: false, proconfig: ['search_path=pg_catalog, public, pg_temp'] },
  {
    proname: 'slpc_side_shape_ok',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'slpc_tuple_matches',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'slpc_validate_change',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'slpcr_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'service_lines_cancel_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'leave_history_report_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'leave_history_report_row_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'line_performers_cancel_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'slc_validate_line',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  { proname: 'slc_complete', prosecdef: false, proconfig: ['search_path=pg_catalog, public, pg_temp'] },
  {
    proname: 'discount_proposals_transition_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'session_tip_revisions_begin',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'session_tips_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_blocked_corrections_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_statements_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_statements_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_statement_frozen_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_statement_exports_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_statement_exports_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_statement_payments_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'commission_statements_payment_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'rating_requests_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'rating_requests_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'rating_requests_consumed_has_rating',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'rating_performers_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'ratings_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'rating_attributions_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'ratings_attributions_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'customers_opt_out_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'customers_profile_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_components_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_components_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_entitlement_value_conservation',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_entitlements_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_entitlements_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_session_slots_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_session_slots_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_refund_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_refund_slot_state_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_refund_slots_sessions_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_refund_validate',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_refund_validate_entitlement',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_refund_validate_slots',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'package_sale_request_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  {
    proname: 'service_category_closing_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public, pg_temp'],
  },
  ...COMMISSION_COVERAGE_FUNCTIONS,
  ...REMINDER_RECOVERY_FUNCTIONS,
].sort((a, b) => a.proname.localeCompare(b.proname));
