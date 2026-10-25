export const FUNCTION_INVENTORY = [
  { proname: 'staff_columns_distinct', prosecdef: false, proconfig: ['search_path=pg_catalog'] },
  { proname: 'orders_check_performers', prosecdef: false, proconfig: ['search_path=pg_catalog, public'] },
  { proname: 'orders_performer_consistency', prosecdef: false, proconfig: ['search_path=pg_catalog, public'] },
  {
    proname: 'initialize_attendance_state',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'employee_branches_close_once',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog'],
  },
  {
    proname: 'enforce_passkey_installation_set_once',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog'],
  },
  {
    proname: 'enforce_staff_otp_attempt',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog'],
  },
  {
    proname: 'enforce_staff_otp_challenge',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog'],
  },
  {
    proname: 'enforce_staff_session',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog'],
  },
  {
    proname: 'invalidate_staff_phone_binding',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog'],
  },
  { proname: 'app_company_id', prosecdef: false, proconfig: ['search_path=pg_catalog'] },
  { proname: 'app_user_id', prosecdef: false, proconfig: ['search_path=pg_catalog'] },
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
    proname: 'platform_whatsapp_is_suppressed',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'pospay_system_id',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog'],
  },
  {
    proname: 'push_attempts_guard',
    prosecdef: false,
    proconfig: ['search_path=public, pg_temp'],
  },
  {
    proname: 'sweep_expired_idempotency_keys',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'service_session_recoveries_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'line_performers_change_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'service_lines_performer_transition',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  { proname: 'slpc_begin', prosecdef: false, proconfig: ['search_path=pg_catalog, public'] },
  {
    proname: 'slpc_change_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  { proname: 'slpc_same_tuple', prosecdef: false, proconfig: ['search_path=pg_catalog, public'] },
  {
    proname: 'slpc_side_shape_ok',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'slpc_tuple_matches',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'slpc_validate_change',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'slpcr_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'service_lines_cancel_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'line_performers_cancel_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'slc_validate_line',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  { proname: 'slc_complete', prosecdef: false, proconfig: ['search_path=pg_catalog, public'] },
  {
    proname: 'discount_proposals_transition_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'session_tip_revisions_begin',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'session_tips_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'commission_statements_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'commission_statements_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'commission_statement_frozen_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'rating_requests_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'rating_requests_update_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'rating_requests_consumed_has_rating',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'rating_performers_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'ratings_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'rating_attributions_insert_guard',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
  {
    proname: 'ratings_attributions_complete',
    prosecdef: false,
    proconfig: ['search_path=pg_catalog, public'],
  },
].sort((a, b) => a.proname.localeCompare(b.proname));
