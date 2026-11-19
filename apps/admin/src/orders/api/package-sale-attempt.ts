import { sellPackageInput } from '@pospay/contracts';
import type { SellPackageInput } from '@pospay/contracts';

export const PACKAGE_SALE_REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;

// A manual or NTP correction of at most this much must not expire a fresh attempt.
export const PACKAGE_SALE_CLOCK_SKEW_MS = 5 * 60 * 1000;

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

// Decides on the record freshly read inside the scope lock and writes only while the lock
// still holds the given key, so an outcome that raced the lock can never overwrite a newer
// record. `revise` returning `undefined` leaves the stored record in place, `null` removes it.
export function reviseOwnedSaleAttempt(
  scope: string,
  key: string,
  revise: (stored: HeldAttempt) => HeldAttempt | null | undefined,
): Promise<{ stored: HeldAttempt | null; saved: boolean }> {
  return withSaleAttemptLock(scope, () => {
    const stored = readSaleAttempt(scope);
    if (stored === null || stored.key !== key) return { stored, saved: true };
    const revised = revise(stored);
    if (revised === undefined) return { stored, saved: true };
    const saved = saveSaleAttempt(scope, revised);
    return { stored: saved ? revised : stored, saved };
  });
}

export function updateOwnedSaleAttempt(
  scope: string,
  key: string,
  attempt: HeldAttempt | null,
): Promise<boolean> {
  return reviseOwnedSaleAttempt(scope, key, () => attempt).then((result) => result.saved);
}

export function statusOnlyAttempt(attempt: HeldAttempt, saleId: string): HeldAttempt {
  return { key: attempt.key, scope: attempt.scope, createdAt: attempt.createdAt, saleId };
}

export function saleAttemptExpired(attempt: HeldAttempt, now: number): boolean {
  const last = attempt.seenAt ?? attempt.createdAt;
  return (
    now < last - PACKAGE_SALE_CLOCK_SKEW_MS ||
    Math.max(now, last) - attempt.createdAt >= PACKAGE_SALE_REPLAY_WINDOW_MS
  );
}

export function saleAttemptExpiresIn(attempt: HeldAttempt, now: number): number {
  if (saleAttemptExpired(attempt, now)) return 0;
  const last = attempt.seenAt ?? attempt.createdAt;
  return Math.max(0, attempt.createdAt + PACKAGE_SALE_REPLAY_WINDOW_MS - Math.max(now, last));
}

// Records an observation of the attempt at `now`: an observed expiry is latched so it stays
// expired whatever the clock does later, and earlier observations within one minute are
// absorbed to keep storage writes rare. Status-only records are never touched.
export function touchSaleAttempt(attempt: HeldAttempt, now: number): HeldAttempt {
  if (attempt.saleId !== undefined) return attempt;
  const last = attempt.seenAt ?? attempt.createdAt;
  if (saleAttemptExpired(attempt, now)) {
    const latched = Math.max(now, last, attempt.createdAt + PACKAGE_SALE_REPLAY_WINDOW_MS);
    if (attempt.seenAt === latched) return attempt;
    return { ...attempt, seenAt: latched };
  }
  if (now - last < 60_000) return attempt;
  return { ...attempt, seenAt: now };
}
