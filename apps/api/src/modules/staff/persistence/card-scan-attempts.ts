import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import {
  CardScanAttemptsUnavailableError,
  type CardScanAttemptDecision,
  type CardScanAttempts,
} from '../ports/card-scan-attempts.port.ts';
import type { EmployeeCardHash } from './employee-card-hash.ts';

// قرار 2026-10-07: عشرة مسحات فاشلة كل عشر دقائق لكل جهاز مزدوج. الشباك ثابت بجانب السقف.
export const CARD_SCAN_FAILURES_PER_WINDOW = 10;
export const CARD_SCAN_WINDOW_SECONDS = 600;

/** يبلّغ جذر التركيب بخطأ Redis الأصلي من غير أن يبتلعه العدّاد. */
export type CardScanAttemptsReport = (error: unknown, companyId: string, deviceId: string) => void;

function attemptKey(companyId: string, deviceId: string): string {
  return `card-scan:${companyId}:${deviceId}`;
}

function doneKey(
  hash: EmployeeCardHash,
  companyId: string,
  deviceId: string,
  idempotencyKey: string,
  fingerprint: string,
): string {
  const marker = hash(companyId, JSON.stringify([idempotencyKey, fingerprint]), 'scan-attempt');
  return `${attemptKey(companyId, deviceId)}:${marker}`;
}

async function guard<T>(work: () => Promise<T>, report: (error: unknown) => void): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CardScanAttemptsUnavailableError) throw error;
    report(error);
    throw new CardScanAttemptsUnavailableError();
  }
}

async function readDecision(
  limiter: RateLimiter,
  hash: EmployeeCardHash,
  companyId: string,
  deviceId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<CardScanAttemptDecision> {
  const attempts = attemptKey(companyId, deviceId);
  const done = doneKey(hash, companyId, deviceId, idempotencyKey, fingerprint);
  if (await limiter.remembered(done)) return { outcome: 'replay' };
  if ((await limiter.count(attempts)) < CARD_SCAN_FAILURES_PER_WINDOW) return { outcome: 'open' };
  const left = await limiter.remaining(attempts);
  // Retry-After: 0 يعني أعد حالاً. الثانية الواحدة تمنع الطرق حين تنتهي القراءة بلا TTL.
  return { outcome: 'limited', remaining: left > 0 ? left : 1 };
}

export function createCardScanAttempts(
  limiter: RateLimiter,
  hash: EmployeeCardHash,
  reportUnavailable: CardScanAttemptsReport,
): CardScanAttempts {
  const report =
    (companyId: string, deviceId: string) =>
    (error: unknown): void =>
      reportUnavailable(error, companyId, deviceId);
  return {
    inspect: (companyId, deviceId, idempotencyKey, fingerprint) =>
      guard(
        () => readDecision(limiter, hash, companyId, deviceId, idempotencyKey, fingerprint),
        report(companyId, deviceId),
      ),
    recordFailure: (companyId, deviceId) =>
      guard(
        async () => {
          await limiter.hit(
            attemptKey(companyId, deviceId),
            CARD_SCAN_FAILURES_PER_WINDOW,
            CARD_SCAN_WINDOW_SECONDS,
          );
        },
        report(companyId, deviceId),
      ),
    complete: (companyId, deviceId, idempotencyKey, fingerprint) =>
      guard(
        () =>
          limiter.remember(
            doneKey(hash, companyId, deviceId, idempotencyKey, fingerprint),
            CARD_SCAN_WINDOW_SECONDS,
          ),
        report(companyId, deviceId),
      ),
  };
}
