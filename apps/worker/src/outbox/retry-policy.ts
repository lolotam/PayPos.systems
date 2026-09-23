// Poison events (Waleed, 2026-09-23): 10 attempts with exponential backoff, then the event is parked.
export const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60 * 60 * 1000;

/**
 * How long to wait before the next attempt, after `attempt` has failed: 5 s, 10 s, 20 s … capped at one
 * hour. `null` when that was the last attempt — the event is parked, not retried.
 *
 * @param attempt the attempt that just failed, starting at 1
 * @returns the delay in ms, or null to park
 */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt starts at 1');
  if (attempt >= MAX_ATTEMPTS) return null;
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}
