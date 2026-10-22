// اشتراك الدفع بيتعدّل في أسراره وسبب سحبه بس؛ الشركة والمستخدم ومعرّف التثبيت وهوية الصف ثابتين (ADR-0052 §3).
export const PUSH_SUBSCRIPTION_COLUMN_GRANTS = [
  'auth',
  'delivery_token',
  'endpoint',
  'endpoint_hash',
  'generation',
  'last_seen_at',
  'locale',
  'p256dh',
  'revoked_at',
  'revoked_reason',
  'updated_at',
  'vapid_key_id',
].map((column) => `push_subscriptions.${column}:pospay_app:UPDATE`);
