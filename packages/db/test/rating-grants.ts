// التطبيق يغيّر مسار الطلب وأعمدة الرابط فقط؛ الهوية ودليلا المعاملة لا يُكتبان بمنح الأعمدة.
export const RATING_REQUEST_COLUMN_GRANTS = [
  'branch_id',
  'due_at',
  'send_deadline',
  'status',
  'cancel_reason',
  'token_hash',
  'token_key_version',
  'expires_at',
  'claimed_at',
  'ready_event_id',
  'sent_at',
  'consumed_at',
  'updated_at',
].map((column) => `rating_requests.${column}:pospay_app:UPDATE`);

// لقطات المنفذين والتقييم والنسب إدخال فقط؛ لا UPDATE أو DELETE أو TRUNCATE لأي جدول.
export const RATING_TABLE_GRANTS = [
  'rating_attributions:INSERT',
  'rating_attributions:SELECT',
  'rating_performers:INSERT',
  'rating_performers:SELECT',
  'rating_requests:INSERT',
  'rating_requests:SELECT',
  'ratings:INSERT',
  'ratings:SELECT',
];
