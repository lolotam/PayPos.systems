'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { endMembershipResult } from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import { useWorkspace, type WorkspaceController } from '@/workspace/model/workspace-provider';

async function endMembership(companyId: string, membershipId: string) {
  const response = await apiClient().POST('/v1/memberships/{membershipId}/end', {
    params: { header: { 'x-company-id': companyId }, path: { membershipId } },
  });
  if (response.error) throw response.error;
  return endMembershipResult.parse(response.data);
}

export function useEndMembership(companyId: string, userId: string, membershipId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => endMembership(companyId, membershipId),
    onMutate: () => ({ queryKey: ['permissions', companyId, userId] as const }),
    onSuccess: (_ended, _vars, context) => client.invalidateQueries({ queryKey: context.queryKey }),
  });
}

// اللوحة بتتعرض أحيانًا بدون WorkspaceProvider (اختبارات اللوحة القديمة)، فالغياب معناه «مفيش صلاحية».
function readOptionalWorkspace(read: () => WorkspaceController): WorkspaceController | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function useCanEndMembership(): boolean {
  const workspace = readOptionalWorkspace(useWorkspace);
  if (workspace === null || workspace.staffAccess !== true) return false;
  const company = 'company' in workspace ? workspace.company : undefined;
  return company?.role_code === 'owner' || company?.is_owner === true;
}
