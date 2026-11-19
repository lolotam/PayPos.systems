import { sellPackageInput } from '@pospay/contracts';
import type { SellPackageInput } from '@pospay/contracts';

export const PACKAGE_SALE_REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;

export type HeldAttempt = {
  key: string;
  scope: string;
  createdAt: number;
  seenAt?: number;
  body?: SellPackageInput;
  saleId?: string;
};

export function saveSaleAttempt(scope: string, attempt: HeldAttempt | null): boolean {
  try {
    const key = `pospay:package-sale:${scope}`;
    if (attempt) localStorage.setItem(key, JSON.stringify(attempt));
    else localStorage.removeItem(key);
    return true;
  } catch {
    // Storage may be disabled or full; the hook retains the original attempt in memory.
    return false;
  }
}

const isShortKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64;

export function readSaleAttempt(scope: string): HeldAttempt | null {
  try {
    const raw = localStorage.getItem(`pospay:package-sale:${scope}`);
    const attempt = raw ? (JSON.parse(raw) as HeldAttempt) : null;
    if (
      !attempt ||
      attempt.scope !== scope ||
      !isShortKey(attempt.key) ||
      !Number.isFinite(attempt.createdAt) ||
      (attempt.seenAt !== undefined && !Number.isFinite(attempt.seenAt)) ||
      (attempt.saleId !== undefined && !isShortKey(attempt.saleId)) ||
      (attempt.body === undefined
        ? attempt.saleId === undefined
        : !sellPackageInput.safeParse(attempt.body).success)
    )
      return null;
    return attempt;
  } catch {
    return null;
  }
}

export function withSaleAttemptLock<T>(scope: string, reserve: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function')
    return navigator.locks.request(`pospay:package-sale:${scope}`, reserve);
  return Promise.resolve(reserve());
}

export function updateOwnedSaleAttempt(
  scope: string,
  key: string,
  attempt: HeldAttempt | null,
): Promise<boolean> {
  return withSaleAttemptLock(scope, () => {
    if (readSaleAttempt(scope)?.key !== key) return true;
    return saveSaleAttempt(scope, attempt);
  });
}

export function statusOnlyAttempt(attempt: HeldAttempt, saleId: string): HeldAttempt {
  return { key: attempt.key, scope: attempt.scope, createdAt: attempt.createdAt, saleId };
}

export function saleAttemptExpired(attempt: HeldAttempt, now: number): boolean {
  if (now < attempt.createdAt) return true;
  return (
    Math.max(now, attempt.seenAt ?? attempt.createdAt) - attempt.createdAt >=
    PACKAGE_SALE_REPLAY_WINDOW_MS
  );
}

export function saleAttemptExpiresIn(attempt: HeldAttempt, now: number): number {
  if (saleAttemptExpired(attempt, now)) return 0;
  return Math.max(0, attempt.createdAt + PACKAGE_SALE_REPLAY_WINDOW_MS - now);
}

export function touchSaleAttempt(attempt: HeldAttempt, now: number): HeldAttempt {
  if (now - (attempt.seenAt ?? attempt.createdAt) < 60_000) return attempt;
  return { ...attempt, seenAt: now };
}
