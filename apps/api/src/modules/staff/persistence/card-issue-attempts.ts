import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import {
  CardIssueAttemptsUnavailableError,
  type CardIssueAttemptDecision,
  type CardIssueAttempts,
} from '../ports/card-issue-attempts.port.ts';
import type { EmployeeCardHash } from './employee-card-hash.ts';

// قرار 2026-10-07: 30 محاولة في الساعة لكل شركة ومستخدم. الشباك ثابت بجانب السقف.
export const CARD_ISSUE_ATTEMPTS_PER_HOUR = 30;
const CARD_ISSUE_WINDOW_SECONDS = 3600;

/** يبلّغ جذر التركيب بخطأ Redis الأصلي من غير أن يبتلعه العدّاد. */
export type CardIssueAttemptsReport = (
  error: unknown,
  companyId: string,
  userId: string,
) => void;

function attemptKey(companyId: string, userId: string): string {
  return `card-issue:${companyId}:${userId}`;
}

function doneKey(
  hash: EmployeeCardHash,
  companyId: string,
  userId: string,
  idempotencyKey: string,
  fingerprint: string,
): string {
  const marker = hash(companyId, JSON.stringify([idempotencyKey, fingerprint]), 'issue-attempt');
  return `${attemptKey(companyId, userId)}:${marker}`;
}

async function guard<T>(work: () => Promise<T>, report: (error: unknown) => void): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CardIssueAttemptsUnavailableError) throw error;
    report(error);
    throw new CardIssueAttemptsUnavailableError();
  }
}

async function decide(
  limiter: RateLimiter,
  hash: EmployeeCardHash,
  companyId: string,
  userId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<CardIssueAttemptDecision> {
  const done = doneKey(hash, companyId, userId, idempotencyKey, fingerprint);
  if (await limiter.remembered(done)) return { outcome: 'replay' };
  const name = attemptKey(companyId, userId);
  const allowed = await limiter.hit(name, CARD_ISSUE_ATTEMPTS_PER_HOUR, CARD_ISSUE_WINDOW_SECONDS);
  if (allowed) return { outcome: 'accepted' };
  const left = await limiter.remaining(name);
  // Retry-After: 0 يعني أعد حالاً. الثانية الواحدة تمنع الطرق حين تنتهي القراءة بلا TTL.
  return { outcome: 'limited', retryAfterSeconds: left > 0 ? left : 1 };
}

export function createCardIssueAttempts(
  limiter: RateLimiter,
  hash: EmployeeCardHash,
  reportUnavailable: CardIssueAttemptsReport,
): CardIssueAttempts {
  const report =
    (companyId: string, userId: string) =>
    (error: unknown): void =>
      reportUnavailable(error, companyId, userId);
  return {
    take: (companyId, userId, idempotencyKey, fingerprint) =>
      guard(
        () => decide(limiter, hash, companyId, userId, idempotencyKey, fingerprint),
        report(companyId, userId),
      ),
    complete: (companyId, userId, idempotencyKey, fingerprint) =>
      guard(
        () =>
          limiter.remember(
            doneKey(hash, companyId, userId, idempotencyKey, fingerprint),
            CARD_ISSUE_WINDOW_SECONDS,
          ),
        report(companyId, userId),
      ),
  };
}
