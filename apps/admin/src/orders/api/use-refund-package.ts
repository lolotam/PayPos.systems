'use client';
import {
  packageRefundResponse,
  type PackageRefundResponse,
  type RefundPackageInput,
} from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const refundPath =
  '/v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/refunds';
export type HeldAttempt = { key: string; fingerprint: string };

function dropAttemptOnKnownError(error: unknown): boolean {
  const err =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown; code?: unknown })
      : {};
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status === 401 || status === 408 || status === 429) return false;
  if (status === 409 && err.code === 'IDEMPOTENCY_KEY_IN_PROGRESS') return false;
  return status !== undefined && status >= 400 && status < 500;
}

async function postRefund(
  scope: SessionServiceScope,
  entitlementId: string,
  body: RefundPackageInput,
  held: { current: HeldAttempt | null },
): Promise<PackageRefundResponse> {
  const fingerprint = JSON.stringify({
    companyId: scope.companyId,
    businessId: scope.businessId,
    branchId: scope.branchId,
    userId: scope.userId,
    entitlementId,
    body,
  });
  const attempt =
    held.current?.fingerprint === fingerprint
      ? held.current
      : { key: crypto.randomUUID(), fingerprint };
  held.current = attempt;
  const result = await apiClient().POST(refundPath, {
    params: {
      header: { 'x-company-id': scope.companyId, 'Idempotency-Key': attempt.key },
      path: { businessId: scope.businessId, branchId: scope.branchId, entitlementId },
    },
    body: {
      component_id: body.component_id,
      sessions: body.sessions,
      method: body.method,
      reason: body.reason,
    },
  });
  if (result.error) {
    const failure = { ...result.error, status: result.response.status };
    // الرفض المعروف بس بيحرر المفتاح؛ فشل الشبكة والرد المؤقت ممكن يخفوا نجاح الطلب الأول.
    if (dropAttemptOnKnownError(failure)) held.current = null;
    throw failure;
  }
  const parsed = packageRefundResponse.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  held.current = null;
  return parsed.data;
}

export function useRefundPackage(
  scope: SessionServiceScope,
  customerId: string,
  entitlementId: string,
  externalHeld?: { current: HeldAttempt | null } | undefined,
) {
  const queryClient = useQueryClient();
  const internalHeld = useRef<HeldAttempt | null>(null);
  const held = externalHeld ?? internalHeld;
  return useMutation({
    mutationKey: [
      'refund-package',
      scope.companyId,
      scope.businessId,
      scope.branchId,
      entitlementId,
    ],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (body: RefundPackageInput) => postRefund(scope, entitlementId, body, held),
    onSuccess: () => {
      const suffix = [scope.companyId, scope.businessId, scope.branchId, scope.userId, customerId];
      void queryClient.invalidateQueries({ queryKey: ['customer-package-detail', ...suffix] });
      void queryClient.invalidateQueries({ queryKey: ['customer-packages', ...suffix] });
    },
  });
}
