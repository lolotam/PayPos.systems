// Every message the worker logs (CLAUDE.md §8). Anything else is replaced by "log message withheld".
export const WORKER_LOG_EVENTS = [
  'worker failed to start',
  'redis connection error',
  'outbox delivery failed',
  'outbox event parked',
  'outbox dispatch failed',
  'idempotency keys swept',
] as const;
