// Moved out of privileges.spec.ts unchanged (max-lines); the recovery row's lifecycle columns only.
export const RECOVERY_COLUMN_GRANTS = [
  'service_session_recoveries.committed_at:pospay_app:UPDATE',
  'service_session_recoveries.expires_at:pospay_app:UPDATE',
  'service_session_recoveries.last_seen_at:pospay_app:UPDATE',
  'service_session_recoveries.revoked_at:pospay_app:UPDATE',
  'service_session_recoveries.revoked_outcome:pospay_app:UPDATE',
  'service_session_recoveries.session_id:pospay_app:UPDATE',
];
