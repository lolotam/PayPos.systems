import { sellPackageInput } from '@pospay/contracts';
import type { SellPackageInput } from '@pospay/contracts';

export type HeldAttempt = {
  key: string;
  scope: string;
  body: SellPackageInput;
  createdAt: number;
  saleId?: string;
};

export function saveSaleAttempt(scope: string, attempt: HeldAttempt | null) {
  try {
    const key = `pospay:package-sale:${scope}`;
    if (attempt) localStorage.setItem(key, JSON.stringify(attempt));
    else localStorage.removeItem(key);
  } catch {
    // Storage may be disabled or full; the hook retains the original attempt in memory.
  }
}

export function readSaleAttempt(scope: string, storage?: Storage): HeldAttempt | null {
  try {
    const raw = (storage ?? localStorage).getItem(`pospay:package-sale:${scope}`);
    const attempt = raw ? (JSON.parse(raw) as HeldAttempt) : null;
    if (
      !attempt ||
      attempt.scope !== scope ||
      typeof attempt.key !== 'string' ||
      !Number.isFinite(attempt.createdAt) ||
      !sellPackageInput.safeParse(attempt.body).success ||
      (attempt.saleId !== undefined && typeof attempt.saleId !== 'string')
    )
      return null;
    return attempt;
  } catch {
    return null;
  }
}

export function restoreSaleAttempt(scope: string): HeldAttempt | null {
  const current = readSaleAttempt(scope);
  try {
    const legacy = readSaleAttempt(scope, sessionStorage);
    if (!legacy) return current;
    const attempt = current ?? legacy;
    const key = `pospay:package-sale:${scope}`;
    localStorage.setItem(key, JSON.stringify(attempt));
    sessionStorage.removeItem(key);
    return attempt;
  } catch {
    return current;
  }
}

export function withSaleAttemptLock<T>(scope: string, reserve: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function')
    return navigator.locks.request(`pospay:package-sale:${scope}`, reserve);
  return Promise.resolve(reserve());
}
