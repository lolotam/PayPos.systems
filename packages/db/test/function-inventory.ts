export const FUNCTION_INVENTORY = [
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
    proname: 'platform_whatsapp_is_suppressed',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
  {
    proname: 'sweep_expired_idempotency_keys',
    prosecdef: true,
    proconfig: ['search_path=pg_catalog, pg_temp'],
  },
].sort((a, b) => a.proname.localeCompare(b.proname));
