'use client';
import { acceptedPackageSale, type SellPackageInput } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { apiClient } from '@/shared/api/client';
import { packageSaleParams, packageSaleScopeKey } from './use-package-sale-context';
import {
  readSaleAttempt,
  saleAttemptExpired,
  saveSaleAttempt,
  statusOnlyAttempt,
  touchSaleAttempt,
  updateOwnedSaleAttempt,
  withSaleAttemptLock,
  type HeldAttempt,
} from './package-sale-attempt';
import { usePackageSaleWindow } from './use-package-sale-window';
import type { SessionServiceScope } from './use-session-services';

const salePath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales';

type SaleJournal = {
  held: Map<string, HeldAttempt>;
  unsaved: Set<string>;
  onPersist: (scopeKey: string, ok: boolean) => void;
};

function createSaleJournal(
  journalRef: RefObject<SaleJournal | null>,
  refresh: (update: (value: number) => number) => void,
): SaleJournal {
  return {
    held: new Map(),
    unsaved: new Set(),
    onPersist: (scopeKey, ok) => {
      const journal = journalRef.current;
      if (journal === null) return;
      if (ok) journal.unsaved.delete(scopeKey);
      else journal.unsaved.add(scopeKey);
      refresh((value) => value + 1);
    },
  };
}

function dropAttemptOnKnownError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (status === 401 || status === 408 || status === 429) return false;
  if (status === 409 && code === 'IDEMPOTENCY_KEY_IN_PROGRESS') return false;
  return typeof status === 'number' && status >= 400 && status < 500;
}

type SaleReservation = { attempt: HeldAttempt; saved: boolean };

function reserveSale(
  scopeKey: string,
  body: SellPackageInput | undefined,
  journal: SaleJournal,
): Promise<SaleReservation> {
  return withSaleAttemptLock(scopeKey, (): SaleReservation => {
    const saved = readSaleAttempt(scopeKey) ?? journal.held.get(scopeKey) ?? null;
    const attempt = saved
      ? touchSaleAttempt(saved, Date.now())
      : body && {
          key: crypto.randomUUID(),
          scope: scopeKey,
          body,
          createdAt: Date.now(),
        };
    if (!attempt) throw new Error('No original package sale to retry');
    journal.held.set(scopeKey, attempt);
    if (saved && body && typeof navigator.locks?.request === 'function')
      throw new Error('PACKAGE_SALE_RECOVERY_REQUIRED');
    journal.onPersist(scopeKey, saveSaleAttempt(scopeKey, attempt));
    return { attempt, saved: saved !== null };
  });
}

async function postSale(
  scope: SessionServiceScope,
  body: SellPackageInput | undefined,
  journal: SaleJournal,
): Promise<string> {
  const scopeKey = JSON.stringify(packageSaleScopeKey(scope));
  const { attempt, saved } = await reserveSale(scopeKey, body, journal);
  if (attempt.saleId) return attempt.saleId;
  if (!attempt.body) throw new Error('No original package sale to retry');
  if (saleAttemptExpired(attempt, Date.now()))
    throw new Error('PACKAGE_SALE_VERIFICATION_REQUIRED');
  const { sold_at, recorder_membership_id, ...required } = attempt.body;
  const result = await apiClient().POST(salePath, {
    signal: AbortSignal.timeout(15_000),
    params: {
      ...packageSaleParams(scope),
      header: {
        'x-company-id': scope.companyId,
        'Idempotency-Key': attempt.key,
      },
    },
    body: {
      ...required,
      ...(sold_at === undefined ? {} : { sold_at }),
      ...(recorder_membership_id === undefined ? {} : { recorder_membership_id }),
    },
  });
  if (result.error) {
    const failure = { ...result.error, status: result.response.status };
    // A refusal on replay can occur before the server looks up the original request.
    if (!saved && dropAttemptOnKnownError(failure)) {
      await updateOwnedSaleAttempt(scopeKey, attempt.key, null);
      if (journal.held.get(scopeKey)?.key === attempt.key) journal.held.delete(scopeKey);
    }
    throw failure;
  }
  const parsed = acceptedPackageSale.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  const settled = statusOnlyAttempt(attempt, parsed.data.sale_request_id);
  if (journal.held.get(scopeKey)?.key === attempt.key) journal.held.set(scopeKey, settled);
  // The update resolves true when the record is merely unreadable, so only a device read that
  // still holds this key proves the status-only record was saved.
  const persisted =
    (await updateOwnedSaleAttempt(scopeKey, attempt.key, settled)) &&
    readSaleAttempt(scopeKey)?.key === attempt.key;
  journal.onPersist(scopeKey, persisted);
  return parsed.data.sale_request_id;
}

function useRestoredSaleAttempt(scopeKey: string, journal: SaleJournal, onRestored: () => void) {
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  useEffect(() => {
    const restored = readSaleAttempt(scopeKey);
    if (restored) {
      const touched = touchSaleAttempt(restored, Date.now());
      journal.held.set(scopeKey, touched);
      if (touched !== restored) void updateOwnedSaleAttempt(scopeKey, restored.key, touched);
      onRestored();
    }
    setRestoredScope(scopeKey);
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== `pospay:package-sale:${scopeKey}`) return;
      const record = readSaleAttempt(scopeKey);
      // A scope whose journal write failed keeps its in-memory attempt across other tabs' events.
      if (record) journal.held.set(scopeKey, record);
      else if (!journal.unsaved.has(scopeKey)) journal.held.delete(scopeKey);
      onRestored();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [scopeKey, journal, onRestored]);
  return restoredScope;
}

export function useSellPackage(scope: SessionServiceScope) {
  const scopeKey = JSON.stringify(packageSaleScopeKey(scope));
  const journalRef = useRef<SaleJournal | null>(null);
  const [, refresh] = useState(0);
  if (journalRef.current === null) journalRef.current = createSaleJournal(journalRef, refresh);
  const journal = journalRef.current;
  const bump = useCallback(() => refresh((value) => value + 1), []);
  const restoredScope = useRestoredSaleAttempt(scopeKey, journal, bump);
  const entry = journal.held.get(scopeKey);
  usePackageSaleWindow(entry);
  const mutation = useMutation({
    mutationKey: ['sell-package', ...packageSaleScopeKey(scope)],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (body: SellPackageInput | undefined) => postSale(scope, body, journal),
  });
  const recoveryRequired = entry !== undefined && entry.saleId === undefined;
  const verificationRequired =
    recoveryRequired && entry !== undefined && saleAttemptExpired(entry, Date.now());
  const discardExpired = async (): Promise<void> => {
    // The closure outlives the render that created it, so the held entry must be re-read now.
    const entry = journal.held.get(scopeKey);
    if (
      entry === undefined ||
      entry.saleId !== undefined ||
      !saleAttemptExpired(entry, Date.now()) ||
      mutation.isPending
    )
      return;
    await updateOwnedSaleAttempt(scopeKey, entry.key, null);
    if (journal.held.get(scopeKey)?.key === entry.key) journal.held.delete(scopeKey);
    journal.unsaved.delete(scopeKey);
    mutation.reset();
    bump();
  };
  return {
    ...mutation,
    releaseFailed: (saleId: string | null) => {
      // The status-read callback runs after later renders, so the held entry must be re-read now.
      const entry = journal.held.get(scopeKey);
      if (entry !== undefined && entry.saleId === saleId) {
        journal.held.delete(scopeKey);
        journal.unsaved.delete(scopeKey);
        bump();
      }
      mutation.reset();
    },
    recoveryRequired,
    verificationRequired,
    attemptKey: entry?.key ?? null,
    journalUnsaved: journal.unsaved.has(scopeKey) && entry !== undefined,
    discardExpired,
    restoring: restoredScope !== scopeKey,
    restoredSaleId: restoredScope === scopeKey ? (entry?.saleId ?? null) : null,
  };
}
