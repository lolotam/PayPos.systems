'use client';
import { acceptedPackageSale, type SellPackageInput } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { packageSaleParams, packageSaleScopeKey } from './use-package-sale-context';
import { readSaleAttempt, saveSaleAttempt, type HeldAttempt } from './package-sale-attempt';
import type { SessionServiceScope } from './use-session-services';

const salePath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales';

function dropAttemptOnKnownError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (status === 401 || status === 408 || status === 429) return false;
  if (status === 409 && code === 'IDEMPOTENCY_KEY_IN_PROGRESS') return false;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function postSale(
  scope: SessionServiceScope,
  body: SellPackageInput | undefined,
  held: { current: HeldAttempt | null },
): Promise<string> {
  const scopeKey = JSON.stringify(packageSaleScopeKey(scope));
  const saved = held.current?.scope === scopeKey ? held.current : null;
  const attempt =
    saved ?? (body && { key: crypto.randomUUID(), scope: scopeKey, body, createdAt: Date.now() });
  if (!attempt) throw new Error('No original package sale to retry');
  held.current = attempt;
  if (attempt.saleId) return attempt.saleId;
  if (Date.now() - attempt.createdAt >= 23 * 60 * 60 * 1000)
    throw new Error('PACKAGE_SALE_VERIFICATION_REQUIRED');
  saveSaleAttempt(scopeKey, attempt);
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
      saveSaleAttempt(scopeKey, null);
      held.current = null;
    }
    throw failure;
  }
  const parsed = acceptedPackageSale.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  attempt.saleId = parsed.data.sale_request_id;
  saveSaleAttempt(scopeKey, attempt);
  return parsed.data.sale_request_id;
}

export function useSellPackage(scope: SessionServiceScope) {
  const held = useRef<HeldAttempt | null>(null);
  const scopeKey = JSON.stringify(packageSaleScopeKey(scope));
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  useEffect(() => {
    held.current = readSaleAttempt(scopeKey);
    setRestoredScope(scopeKey);
  }, [scopeKey]);
  const mutation = useMutation({
    mutationKey: ['sell-package', ...packageSaleScopeKey(scope)],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (body: SellPackageInput | undefined) => postSale(scope, body, held),
  });
  const recoveryRequired = held.current?.scope === scopeKey && !held.current.saleId;
  const verificationRequired =
    recoveryRequired && Date.now() - (held.current?.createdAt ?? 0) >= 23 * 60 * 60 * 1000;
  return {
    ...mutation,
    recoveryRequired,
    verificationRequired,
    restoring: restoredScope !== scopeKey,
    restoredSaleId: restoredScope === scopeKey ? (held.current?.saleId ?? null) : null,
  };
}
