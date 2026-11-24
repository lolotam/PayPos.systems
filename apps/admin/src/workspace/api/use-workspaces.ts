'use client';

import { useQuery } from '@tanstack/react-query';
import { myWorkspacesReadResponse, type MyWorkspacesReadResponse } from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';

export async function fetchWorkspaces(): Promise<MyWorkspacesReadResponse> {
  const { data, error, response } = await apiClient().GET('/v1/me/workspaces');
  // الرفض بيتبعت بحالته زي باقي عملاء Admin، عشان مزوّد مساحة العمل يفرّق رفض الوصول
  // (401/403) عن فشل شبكة أو سيرفر في قرار إبقاء آخر شكل محفوظ.
  if (error) throw { ...(error as object), status: response.status };
  const parsed = myWorkspacesReadResponse.safeParse(data);
  if (!parsed.success) throw new Error('workspace response did not match the contract');
  return parsed.data;
}

export function useWorkspaces(enabled: boolean) {
  return useQuery({
    queryKey: ['me', 'workspaces'],
    queryFn: fetchWorkspaces,
    enabled,
  });
}
