// محاولة الدفع بتتعدّل في حالة الإرسال ونتايجها بس؛ هوية الاشتراك والحدث المصدر والقالب ثابتين (ADR-0052 §5).
export const PUSH_ATTEMPT_COLUMN_GRANTS = [
  'status',
  'execution_id',
  'sending_at',
  'finished_at',
  'failure_code',
  'outcome_known',
  'http_status',
  'updated_at',
].map((column) => `push_attempts.${column}:pospay_app:UPDATE`);
