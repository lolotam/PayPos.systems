'use client';
import { customerProfile, type CustomerProfile } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

import type { SessionCustomerEntryScope } from './use-session-customer';

export type SessionCustomerProfileEntry = {
  readonly companyId: string;
  readonly branchId: string;
  readonly businessId: string | undefined;
  readonly userId: string;
  readonly entryScope: SessionCustomerEntryScope;
  readonly customerId: string | null;
};

async function fetchProfile(
  entry: SessionCustomerProfileEntry,
  customerId: string,
  signal: AbortSignal,
): Promise<CustomerProfile> {
  const header = { 'x-company-id': entry.companyId };
  if (entry.entryScope === 'company') {
    const result = await apiClient().GET('/v1/customers/{customerId}/profile', {
      params: { header, path: { customerId } },
      signal,
      cache: 'no-store',
    });
    if (result.error) throw { ...result.error, status: result.response.status };
    return customerProfile.parse(result.data);
  }
  if (entry.entryScope === 'business') {
    if (entry.businessId === undefined) throw new Error('CUSTOMER_BUSINESS_REQUIRED');
    const result = await apiClient().GET('/v1/businesses/{businessId}/customers/{customerId}/profile', {
      params: { header, path: { businessId: entry.businessId, customerId } },
      signal,
      cache: 'no-store',
    });
    if (result.error) throw { ...result.error, status: result.response.status };
    return customerProfile.parse(result.data);
  }
  const result = await apiClient().GET('/v1/branches/{branchId}/customers/{customerId}/profile', {
    params: { header, path: { branchId: entry.branchId, customerId } },
    signal,
    cache: 'no-store',
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  return customerProfile.parse(result.data);
}

/**
 * قراءة بطاقة الزبونة على نفس نطاق الإدخال اللي اختارته الموظفة.
 * المفتاح بيشمول الهوية والنطاق ومعرّفات المسار والزبونة، فتغيير أي واحد فيهم بيتجاهل الرد القديم.
 */
export function useSessionCustomerProfile(entry: SessionCustomerProfileEntry, canRead = true) {
  const { companyId, branchId, businessId, userId, entryScope, customerId } = entry;
  return useQuery({
    queryKey: [
      'session-customer-profile',
      companyId,
      userId,
      entryScope,
      businessId ?? null,
      branchId,
      customerId,
    ],
    enabled: customerId !== null && canRead,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    // مفيش إرسال لوحده بعد رجوع النت؛ القراءة المعلّقة تفشل فوراً بدل ما تكمّل عند الاتصال.
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    networkMode: 'always',
    queryFn: async ({ signal }) => {
      if (customerId === null) throw new Error('CUSTOMER_SELECTION_MISSING');
      return fetchProfile(entry, customerId, signal);
    },
  });
}
