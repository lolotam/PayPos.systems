'use client';
import {
  serviceCategoryBranchStateResult,
  type ServiceCategoryBranchSettingState,
  type ServiceCategoryBranchStateResult,
} from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { branchServiceCategoryKey } from './use-branch-service-categories';

export type BranchServiceCategoryStateRequest = {
  categoryId: string;
  state: ServiceCategoryBranchSettingState;
  expectedRevision: number | null;
};

async function setBranchState(
  companyId: string,
  businessId: string,
  branchId: string,
  input: BranchServiceCategoryStateRequest,
): Promise<ServiceCategoryBranchStateResult> {
  const response = await apiClient().PUT(
    '/v1/businesses/{businessId}/branches/{branchId}/service-categories/{categoryId}/state',
    {
      params: {
        header: { 'x-company-id': companyId },
        path: { businessId, branchId, categoryId: input.categoryId },
      },
      body: { state: input.state, expected_revision: input.expectedRevision },
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategoryBranchStateResult.parse(response.data);
}

function refusalCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

/**
 * الكتابة بتضمّن القايمتين مع بعض بعد النجاح عشان البند ينتقل للتاب التاني.
 * الرفض اللي بيغيّر معنى الصف (تعارض نسخة أو تصنيف اتقفل أو اختفى) بيحدّث القايمة
 * كمان، لإن الصف اللي على الشاشة بقى قديم؛ الـ403 بيبقى الرسالة بس من غير تحديث.
 */
export function useBranchServiceCategoryState(
  companyId: string,
  businessId: string,
  userId: string,
  branchId: string,
) {
  const client = useQueryClient();
  const branchKey = branchServiceCategoryKey(companyId, businessId, userId, branchId);
  return useMutation({
    mutationKey: ['branch-service-category-state', companyId, businessId, userId, branchId],
    mutationFn: (input: BranchServiceCategoryStateRequest) =>
      setBranchState(companyId, businessId, branchId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: branchKey }),
    onError: (error) => {
      const code = refusalCode(error);
      if (
        code === 'SERVICE_CATEGORY_REVISION_CONFLICT' ||
        code === 'SERVICE_CATEGORY_CLOSED' ||
        code === 'SERVICE_CATEGORY_NOT_FOUND'
      )
        void client.invalidateQueries({ queryKey: branchKey });
    },
  });
}
