'use client';

import { useQuery } from '@tanstack/react-query';
import { myWorkspacesReadResponse, type MyWorkspacesReadResponse } from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';

export async function fetchWorkspaces(): Promise<MyWorkspacesReadResponse> {
  const { data, error, response } = await apiClient().GET('/v1/me/workspaces');
  // القراءة بتحكم على response.ok مش على وجود جسم خطأ: رفض وصول بجسم فاضي (401/403 من غير
  // envelope) لازم يوصل بحالته برضه — مزوّد مساحة العمل بيفرّق رفض الوصول (401/403) عن فشل شبكة
  // أو سيرفر في قرار إبقاء آخر شكل محفوظ، زي ما باقي عملاء Admin بيقراو status الرفض.
  if (!response.ok) throw { ...(error as object | undefined), status: response.status };
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
