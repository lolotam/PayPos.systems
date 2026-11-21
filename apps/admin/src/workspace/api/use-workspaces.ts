'use client';

import { useQuery } from '@tanstack/react-query';
import { myWorkspacesReadResponse, type MyWorkspacesReadResponse } from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';

export async function fetchWorkspaces(): Promise<MyWorkspacesReadResponse> {
  const { data, error } = await apiClient().GET('/v1/me/workspaces');
  if (error) throw error;
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
