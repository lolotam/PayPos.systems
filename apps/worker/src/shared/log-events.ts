// Every message the worker logs (CLAUDE.md §8). Anything else is replaced by "log message withheld".
export const WORKER_LOG_EVENTS = [
  'email disabled',
  'staff OTP capability',
  'staff OTP execution outcome',
  'staff OTP retention unavailable',
  'worker failed to start',
  'redis connection error',
  'outbox delivery failed',
  'outbox event parked',
  'outbox dispatch failed',
  'idempotency keys swept',
  'notification enqueue failed',
  'notification queue error',
  'notification job failed',
  'whatsapp inbox queue error',
  'whatsapp inbox job failed',
] as const;
