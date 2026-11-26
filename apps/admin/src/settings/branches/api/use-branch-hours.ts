'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpeningHours } from '@pospay/contracts';

import { branchKey, readBranch, writeBranchOpeningHours } from './branch-client';

type Scope = { companyId: string; userId: string; businessId: string; branchId: string };

export function useBranch({ companyId, userId, branchId }: Scope) {
  return useQuery({
    queryKey: branchKey(companyId, userId, branchId),
    queryFn: ({ signal }) => readBranch(companyId, branchId, signal),
    retry: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });
}

export function useSetBranchHours({ companyId, userId, businessId, branchId }: Scope) {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (hours: OpeningHours | null) =>
      writeBranchOpeningHours(companyId, businessId, branchId, hours),
    // رد الكتابة هو الفرع المخزّن فعلاً، فبيحل محل المقروء من غير قراءة تانية.
    onSuccess: (saved) => client.setQueryData(branchKey(companyId, userId, branchId), saved),
  });
}
