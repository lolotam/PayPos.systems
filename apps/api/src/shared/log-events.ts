// Every message the API logs (CLAUDE.md §8). A message not in this list — or in BASE_LOG_EVENTS — is
// replaced by "log message withheld"; dynamic values belong in the log object's fields.
export const API_LOG_EVENTS = [
  'email disabled',
  'api failed to start',
  'auth library event',
  'redis connection error',
  'whatsapp inbox queue error',
  'whatsapp intake failed',
  'whatsapp redis unavailable',
  'whatsapp changes skipped',
  'nest',
  'nest error',
  'nest warning',
] as const;
