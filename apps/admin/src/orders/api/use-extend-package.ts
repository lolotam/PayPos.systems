'use client';
import {
  packageExtensionResponse,
  type ExtendPackageInput,
  type PackageExtensionResponse,
} from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const extensionPath =
  '/v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/extensions';
type HeldAttempt = { key: string; fingerprint: string };

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function dropAttemptOnKnownError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 401 || status === 408 || status === 429) return false;
  if (status === 409 && codeOf(error) === 'IDEMPOTENCY_KEY_IN_PROGRESS') return false;
  return status !== undefined && status >= 400 && status < 500;
}

async function postExtension(
  scope: SessionServiceScope,
  entitlementId: string,
  body: ExtendPackageInput,
  held: { current: HeldAttempt | null },
): Promise<PackageExtensionResponse> {
  const fingerprint = JSON.stringify(body);
  const attempt = held.current?.fingerprint === fingerprint
    ? held.current
    : { key: crypto.randomUUID(), fingerprint };
  held.current = attempt;
  const result = await apiClient().POST(extensionPath, {
    params: {
      header: { 'x-company-id': scope.companyId, 'Idempotency-Key': attempt.key },
      path: { businessId: scope.businessId, branchId: scope.branchId, entitlementId },
    },
    body: {
      new_expires_on: body.new_expires_on,
      expected_expires_on: body.expected_expires_on,
      reason: body.reason,
    },
  });
  if (result.error) {
    const failure = { ...result.error, status: result.response.status };
    // الرفض المعروف بس بيحرر المفتاح؛ فشل الشبكة والرد المؤقت ممكن يخفوا نجاح الطلب الأول.
    if (dropAttemptOnKnownError(failure)) held.current = null;
    throw failure;
  }
  const parsed = packageExtensionResponse.safeParse(result.data);
  if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
  held.current = null;
  return parsed.data;
}

export function useExtendPackage(
  scope: SessionServiceScope,
  customerId: string,
  entitlementId: string,
) {
  const queryClient = useQueryClient();
  const held = useRef<HeldAttempt | null>(null);
  return useMutation({
    mutationKey: ['extend-package', scope.companyId, scope.businessId, scope.branchId, entitlementId],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: (body: ExtendPackageInput) => postExtension(scope, entitlementId, body, held),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['customer-package-detail', scope.companyId, scope.businessId, scope.branchId, scope.userId, customerId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['customer-packages', scope.companyId, scope.businessId, scope.branchId, scope.userId, customerId],
      });
    },
  });
}
