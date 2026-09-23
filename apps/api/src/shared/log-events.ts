// Every message the API logs (CLAUDE.md §8). A message not in this list — or in BASE_LOG_EVENTS — is
// replaced by "log message withheld"; dynamic values belong in the log object's fields.
export const API_LOG_EVENTS = [
  'api failed to start',
  'auth library event',
  'redis connection error',
  'nest',
  'nest error',
  'nest warning',
] as const;
