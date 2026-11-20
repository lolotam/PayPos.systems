'use client';
import {
  serviceCategory,
  type CreateBranchServiceCategoryInput,
  type ServiceCategory,
  type ServiceCategoryVisibility,
} from '@pospay/contracts';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { serviceCategoryKey } from './use-service-category-list';
import { key as servicesKey } from './use-services';

const branchSaveKey = (companyId: string, businessId: string, userId: string, branchId: string) =>
  ['branch-service-category-save', companyId, businessId, userId, branchId] as const;

/** يخلّي نموذج الفرع مفتوح لحد ما الكتابة ونتيجتها تخلص. */
export function useBranchServiceCategorySavePending({
  companyId,
  businessId,
  userId,
  branchId,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
}) {
  return useIsMutating({ mutationKey: branchSaveKey(companyId, businessId, userId, branchId) }) > 0;
}

type BranchCategoryNames = { name_en: string; name_ar: string };
type BranchCategoryPatch = BranchCategoryNames & {
  categoryId: string;
  expected_revision: number;
};
type BranchCategoryPatchRequest = BranchCategoryPatch & {
  visibility?: ServiceCategoryVisibility | undefined;
};

async function branchCreate(
  companyId: string,
  businessId: string,
  branchId: string,
  body: CreateBranchServiceCategoryInput,
): Promise<ServiceCategory> {
  const response = await apiClient().POST(
    '/v1/businesses/{businessId}/branches/{branchId}/service-categories',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, branchId } },
      body: { name_en: body.name_en, name_ar: body.name_ar, visibility: body.visibility },
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategory.parse(response.data);
}

async function branchPatch(
  companyId: string,
  businessId: string,
  branchId: string,
  input: BranchCategoryPatchRequest,
): Promise<ServiceCategory> {
  const response = await apiClient().PATCH(
    '/v1/businesses/{businessId}/branches/{branchId}/service-categories/{categoryId}',
    {
      params: {
        header: { 'x-company-id': companyId },
        path: { businessId, branchId, categoryId: input.categoryId },
      },
      body: {
        name_en: input.name_en,
        name_ar: input.name_ar,
        expected_revision: input.expected_revision,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategory.parse(response.data);
}

/**
 * الإنشاء من الفرع بيبطل جذر التصنيفات بس: اختيارات التصنيف في قوايم الفرع بتتحدث،
 * وأسماء الخدمات ما تتأثرش لإن الإنشاء مبيغيّرش تصنيف موجود.
 */
export function useBranchServiceCategoryCreate(
  companyId: string,
  businessId: string,
  userId: string,
  branchId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...branchSaveKey(companyId, businessId, userId, branchId), 'create'],
    mutationFn: (body: CreateBranchServiceCategoryInput) =>
      branchCreate(companyId, businessId, branchId, body),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: serviceCategoryKey(companyId, businessId, userId) }),
  });
}

/**
 * إعادة التسمية لتصنيف الفرع الخاص بس، بـexpected_revision ومن غير مفتاح visibility:
 * المسار بيرفض أي تغيير ظهور من هنا، فإرسال المفتاح رفض مضمون بلا فايدة.
 */
export function useBranchServiceCategoryRename(
  companyId: string,
  businessId: string,
  userId: string,
  branchId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...branchSaveKey(companyId, businessId, userId, branchId), 'rename'],
    mutationFn: (body: BranchCategoryPatch) => branchPatch(companyId, businessId, branchId, body),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: serviceCategoryKey(companyId, businessId, userId) }),
        client.invalidateQueries({ queryKey: servicesKey(companyId, businessId, userId) }),
      ]),
  });
}

/**
 * المشاركة بتبعت أسماء التصنيف الحالية مع visibility BUSINESS وexpected_revision
 * في نفس مسار إعادة التسمية — القرار بيرجع للمدير بعد التحذير إن الرجوع للمستوى الخاص مش ممكن.
 */
export function useBranchServiceCategoryShare(
  companyId: string,
  businessId: string,
  userId: string,
  branchId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...branchSaveKey(companyId, businessId, userId, branchId), 'share'],
    mutationFn: (body: BranchCategoryPatch) =>
      branchPatch(companyId, businessId, branchId, { ...body, visibility: 'BUSINESS' }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: serviceCategoryKey(companyId, businessId, userId) }),
        client.invalidateQueries({ queryKey: servicesKey(companyId, businessId, userId) }),
      ]),
  });
}
