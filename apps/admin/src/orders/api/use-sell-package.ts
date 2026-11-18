'use client';
import { acceptedPackageSale, type SellPackageInput } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import { packageSaleParams, packageSaleScopeKey } from './use-package-sale-context';
import type { SessionServiceScope } from './use-session-services';

const salePath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales';
type HeldAttempt = { key: string; scope: string; body: SellPackageInput };

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
  const attempt = saved ?? (body && { key: crypto.randomUUID(), scope: scopeKey, body });
  if (!attempt) throw new Error('No original package sale to retry');
  held.current = attempt;
  const { sold_at, recorder_membership_id, ...required } = attempt.body;
  const result = await apiClient().POST(salePath, {
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
    if (!saved && dropAttemptOnKnownError(failure)) held.current = null;
    throw failure;
  }
  const parsed = acceptedPackageSale.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  held.current = null;
  return parsed.data.sale_request_id;
}

export function useSellPackage(scope: SessionServiceScope) {
  const held = useRef<HeldAttempt | null>(null);
  const mutation = useMutation({
    mutationKey: ['sell-package', ...packageSaleScopeKey(scope)],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (body: SellPackageInput | undefined) => postSale(scope, body, held),
  });
  const recoveryRequired = held.current?.scope === JSON.stringify(packageSaleScopeKey(scope));
  return { ...mutation, recoveryRequired };
}
