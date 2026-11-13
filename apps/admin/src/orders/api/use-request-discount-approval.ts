'use client';
import { requestDiscountApprovalResponse } from '@pospay/contracts';
import type { components } from '@/shared/api/schema';
import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const requestPath = '/v1/businesses/{businessId}/branches/{branchId}/discount-proposals';
type RequestDiscountApprovalInput = components['schemas']['RequestDiscountApprovalInput'];
type Held = { key: string; fingerprint: string };

// نفس الجسم يحتفظ بنفس المفتاح بعد انقطاع الشبكة؛ النجاح أو تغيّر الشروط يبدأ طلبًا جديدًا.
export function useRequestDiscountApproval(scope: SessionServiceScope) {
  const held = useRef<Held | null>(null);
  return useMutation({
    mutationKey: ['request-discount-approval', scope], retry: false, gcTime: 0, networkMode: 'always',
    mutationFn: async (body: RequestDiscountApprovalInput) => {
      const fingerprint = JSON.stringify({ scope, body });
      const attempt = held.current?.fingerprint === fingerprint ? held.current : { key: crypto.randomUUID(), fingerprint };
      held.current = attempt;
      const result = await apiClient().POST(requestPath, {
        params: { header: { 'x-company-id': scope.companyId, 'Idempotency-Key': attempt.key },
          path: { businessId: scope.businessId, branchId: scope.branchId } },
        body,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      const parsed = requestDiscountApprovalResponse.safeParse(result.data);
      if (!parsed.success) throw Object.assign(parsed.error, { status: result.response.status });
      held.current = null;
      return parsed.data;
    },
  });
}
