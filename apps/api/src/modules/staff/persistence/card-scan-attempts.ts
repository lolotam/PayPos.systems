import { createHash } from 'node:crypto';

import { createLogger, type Logger } from '@pospay/observability';

import { API_LOG_EVENTS } from '../../../shared/log-events.ts';
import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import {
  CardScanAttemptsUnavailableError,
  type CardScanAttemptDecision,
  type CardScanAttempts,
} from '../ports/card-scan-attempts.port.ts';

// قرار 2026-10-07: عشرة مسحات فاشلة كل عشر دقائق لكل جهاز مزدوج. الشباك ثابت بجانب السقف.
export const CARD_SCAN_FAILURES_PER_WINDOW = 10;
export const CARD_SCAN_WINDOW_SECONDS = 600;

const scanRedisLog = createLogger('warn', { events: API_LOG_EVENTS });

function attemptKey(companyId: string, deviceId: string): string {
  return `card-scan:${companyId}:${deviceId}`;
}

// هاش المفتاح مع البصمة: جسم مختلف ليس إعادة، والكود الخام لا يُخزَّن حتى لو وُضع في المفتاح.
function doneKey(
  companyId: string,
  deviceId: string,
  idempotencyKey: string,
  fingerprint: string,
): string {
  const marker = createHash('sha256')
    .update(idempotencyKey)
    .update('\0')
    .update(fingerprint)
    .digest('hex');
  return `${attemptKey(companyId, deviceId)}:${marker}`;
}

async function guard<T>(log: Pick<Logger, 'warn'>, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CardScanAttemptsUnavailableError) throw error;
    log.warn({ err: error }, 'card scan redis unavailable');
    throw new CardScanAttemptsUnavailableError();
  }
}

async function readDecision(
  limiter: RateLimiter,
  companyId: string,
  deviceId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<CardScanAttemptDecision> {
  const attempts = attemptKey(companyId, deviceId);
  if (await limiter.remembered(doneKey(companyId, deviceId, idempotencyKey, fingerprint))) {
    return { outcome: 'replay' };
  }
  if ((await limiter.count(attempts)) < CARD_SCAN_FAILURES_PER_WINDOW) return { outcome: 'open' };
  return { outcome: 'limited', remaining: await limiter.remaining(attempts) };
}

export function createCardScanAttempts(
  limiter: RateLimiter,
  log: Pick<Logger, 'warn'> = scanRedisLog,
): CardScanAttempts {
  return {
    inspect: (companyId, deviceId, idempotencyKey, fingerprint) =>
      guard(log, () => readDecision(limiter, companyId, deviceId, idempotencyKey, fingerprint)),
    recordFailure: (companyId, deviceId) =>
      guard(log, async () => {
        await limiter.hit(
          attemptKey(companyId, deviceId),
          CARD_SCAN_FAILURES_PER_WINDOW,
          CARD_SCAN_WINDOW_SECONDS,
        );
      }),
    complete: (companyId, deviceId, idempotencyKey, fingerprint) =>
      guard(log, () =>
        limiter.remember(
          doneKey(companyId, deviceId, idempotencyKey, fingerprint),
          CARD_SCAN_WINDOW_SECONDS,
        ),
      ),
  };
}
