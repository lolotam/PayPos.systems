'use client';
import { acceptedPackageSale, type SellPackageInput } from '@pospay/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import { packageSaleParams, packageSaleScopeKey } from './use-package-sale-context';
import type { SessionServiceScope } from './use-session-services';

const salePath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales';
type HeldAttempt = { key: string; fingerprint: string };

function dropAttemptOnKnownError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (status === 401 || status === 408 || status === 429) return false;
  if (status === 409 && code === 'IDEMPOTENCY_KEY_IN_PROGRESS') return false;
  return typeof status === 'number' && status >= 400 && status < 500;
}

async function postSale(
  scope: SessionServiceScope,
  body: SellPackageInput,
  held: { current: HeldAttempt | null },
): Promise<string> {
  const fingerprint = JSON.stringify([...packageSaleScopeKey(scope), body]);
  const attempt =
    held.current?.fingerprint === fingerprint
      ? held.current
      : { key: crypto.randomUUID(), fingerprint };
  held.current = attempt;
  const { sold_at, recorder_membership_id, ...required } = body;
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
    if (dropAttemptOnKnownError(failure)) held.current = null;
    throw failure;
  }
  const parsed = acceptedPackageSale.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  held.current = null;
  return parsed.data.sale_request_id;
}

export function useSellPackage(scope: SessionServiceScope) {
  const held = useRef<HeldAttempt | null>(null);
  return useMutation({
    mutationKey: ['sell-package', ...packageSaleScopeKey(scope)],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (body: SellPackageInput) => postSale(scope, body, held),
  });
}
