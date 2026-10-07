import { createHash } from 'node:crypto';

import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import {
  CardIssueAttemptsUnavailableError,
  type CardIssueAttemptDecision,
  type CardIssueAttempts,
} from '../ports/card-issue-attempts.port.ts';

// قرار 2026-10-07: 30 محاولة في الساعة لكل شركة ومستخدم. الشباك ثابت بجانب السقف.
export const CARD_ISSUE_ATTEMPTS_PER_HOUR = 30;
const CARD_ISSUE_WINDOW_SECONDS = 3600;

function attemptKey(companyId: string, userId: string): string {
  return `card-issue:${companyId}:${userId}`;
}

// هاش المفتاح مع البصمة: جسم مختلف محاولة جديدة، والكود الخام لا يُخزَّن حتى لو وُضع في المفتاح.
function doneKey(
  companyId: string,
  userId: string,
  idempotencyKey: string,
  fingerprint: string,
): string {
  const marker = createHash('sha256')
    .update(idempotencyKey)
    .update('\0')
    .update(fingerprint)
    .digest('hex');
  return `${attemptKey(companyId, userId)}:${marker}`;
}

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CardIssueAttemptsUnavailableError) throw error;
    throw new CardIssueAttemptsUnavailableError();
  }
}

async function decide(
  limiter: RateLimiter,
  companyId: string,
  userId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<CardIssueAttemptDecision> {
  const done = doneKey(companyId, userId, idempotencyKey, fingerprint);
  if (await limiter.remembered(done)) return 'replay';
  const allowed = await limiter.hit(
    attemptKey(companyId, userId),
    CARD_ISSUE_ATTEMPTS_PER_HOUR,
    CARD_ISSUE_WINDOW_SECONDS,
  );
  return allowed ? 'accepted' : 'limited';
}

export function createCardIssueAttempts(limiter: RateLimiter): CardIssueAttempts {
  return {
    take: (companyId, userId, idempotencyKey, fingerprint) =>
      guard(() => decide(limiter, companyId, userId, idempotencyKey, fingerprint)),
    complete: (companyId, userId, idempotencyKey, fingerprint) =>
      guard(() =>
        limiter.remember(
          doneKey(companyId, userId, idempotencyKey, fingerprint),
          CARD_ISSUE_WINDOW_SECONDS,
        ),
      ),
  };
}
