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

function parseSaleAttempt(scope: string, raw: string | null): HeldAttempt | null {
  try {
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

// A device that cannot be read is not an empty device: only `readable: false` means the read
// itself threw, while an absent or invalid record is a readable device holding nothing valid.
export function inspectSaleAttempt(scope: string): {
  readable: boolean;
  attempt: HeldAttempt | null;
} {
  let raw: string | null;
  try {
    raw = localStorage.getItem(`pospay:package-sale:${scope}`);
  } catch {
    return { readable: false, attempt: null };
  }
  return { readable: true, attempt: parseSaleAttempt(scope, raw) };
}

export function readSaleAttempt(scope: string): HeldAttempt | null {
  return inspectSaleAttempt(scope).attempt;
}

const lastObservation = (attempt: HeldAttempt): number => attempt.seenAt ?? attempt.createdAt;

// The one rule for a record held in memory against the record on the device. A genuinely
// different attempt on the device wins, a known sale id outranks a missing one, and for the
// same unsettled attempt the later observation survives, so a refused storage write can never
// allow an older stored copy to reopen an expired attempt. Getting the stored object itself
// back tells the caller that the device already reflects the outcome.
export function reconcileSaleAttempt(
  held: HeldAttempt | undefined,
  stored: HeldAttempt,
): HeldAttempt;
export function reconcileSaleAttempt(held: HeldAttempt, stored: HeldAttempt | null): HeldAttempt;
export function reconcileSaleAttempt(
  held: HeldAttempt | undefined,
  stored: HeldAttempt | null,
): HeldAttempt | null;
export function reconcileSaleAttempt(
  held: HeldAttempt | undefined,
  stored: HeldAttempt | null,
): HeldAttempt | null {
  if (stored === null) return held ?? null;
  if (held === undefined || held.key !== stored.key) return stored;
  if (held.saleId !== undefined && stored.saleId === undefined) return held;
  if (stored.saleId !== undefined) return stored;
  if (lastObservation(stored) >= lastObservation(held)) return stored;
  return { ...stored, seenAt: lastObservation(held) };
}

export function withSaleAttemptLock<T>(scope: string, reserve: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function')
    return navigator.locks.request(`pospay:package-sale:${scope}`, reserve);
  return Promise.resolve(reserve());
}

export type RevisedSaleAttempt = { stored: HeldAttempt | null; saved: boolean; readable: boolean };

// Decides on the record freshly read inside the scope lock and writes only while the lock
// still holds the given key, so an outcome that raced the lock can never overwrite a newer
// record. `revise` returning `undefined` leaves the stored record in place, `null` removes it.
// An unreadable device resolves `readable: false` and `saved: false` without calling `revise`.
export function reviseOwnedSaleAttempt(
  scope: string,
  key: string,
  revise: (stored: HeldAttempt) => HeldAttempt | null | undefined,
): Promise<RevisedSaleAttempt> {
  return withSaleAttemptLock(scope, (): RevisedSaleAttempt => {
    const inspected = inspectSaleAttempt(scope);
    if (!inspected.readable) return { stored: null, saved: false, readable: false };
    const stored = inspected.attempt;
    if (stored === null || stored.key !== key) return { stored, saved: true, readable: true };
    const revised = revise(stored);
    if (revised === undefined) return { stored, saved: true, readable: true };
    const saved = saveSaleAttempt(scope, revised);
    return { stored: saved ? revised : stored, saved, readable: true };
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
  const last = lastObservation(attempt);
  return (
    now < last - PACKAGE_SALE_CLOCK_SKEW_MS ||
    Math.max(now, last) - attempt.createdAt >= PACKAGE_SALE_REPLAY_WINDOW_MS
  );
}

export function saleAttemptExpiresIn(attempt: HeldAttempt, now: number): number {
  if (saleAttemptExpired(attempt, now)) return 0;
  const last = lastObservation(attempt);
  return Math.max(0, attempt.createdAt + PACKAGE_SALE_REPLAY_WINDOW_MS - Math.max(now, last));
}

// Records an observation of the attempt at `now`: an observed expiry latches `seenAt` to the
// window's end once, and an already-latched attempt is returned unchanged whatever the clock
// reads next, so repeated observations never rewrite the record. Observations within one
// minute are absorbed to keep storage writes rare. Status-only records are never touched.
export function touchSaleAttempt(attempt: HeldAttempt, now: number): HeldAttempt {
  if (attempt.saleId !== undefined) return attempt;
  const last = lastObservation(attempt);
  if (last - attempt.createdAt >= PACKAGE_SALE_REPLAY_WINDOW_MS) return attempt;
  if (saleAttemptExpired(attempt, now))
    return { ...attempt, seenAt: attempt.createdAt + PACKAGE_SALE_REPLAY_WINDOW_MS };
  if (now - last < 60_000) return attempt;
  return { ...attempt, seenAt: now };
}
