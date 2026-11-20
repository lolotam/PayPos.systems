'use client';
import { service, type Service } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { serviceCategoryKey } from './use-service-category-list';
import { key as servicesKey } from './use-services';

export type ServiceClosingAction = 'close' | 'reopen';

export type ServiceClosingInput = { action: ServiceClosingAction; expectedRevision: number };

// الرفض ده معناه السيرفر شايف حالة أحدث من الكاش، فالتفاصيل تتجدد عشان الشارة والزرار يظهروا الواقع؛
// أما SERVICE_CATEGORY_CLOSED والـ403 فالرسالة كفاية والحالة ما اتغيرتش.
const REFUSAL_REFRESH_CODES = new Set([
  'SERVICE_REVISION_CONFLICT',
  'SERVICE_ALREADY_CLOSED',
  'SERVICE_NOT_CLOSED',
]);

function refreshesDetail(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && REFUSAL_REFRESH_CODES.has(code);
}

async function run(
  companyId: string,
  businessId: string,
  serviceId: string,
  input: ServiceClosingInput,
): Promise<Service> {
  const params = { header: { 'x-company-id': companyId }, path: { businessId, serviceId } };
  const body = { expected_revision: input.expectedRevision };
  const response =
    input.action === 'close'
      ? await apiClient().POST('/v1/businesses/{businessId}/services/{serviceId}/close', {
          params,
          body,
        })
      : await apiClient().POST('/v1/businesses/{businessId}/services/{serviceId}/reopen', {
          params,
          body,
        });
  if (response.error) throw response.error;
  return service.parse(response.data);
}

/**
 * قفل وفتح خدمة واحدة من لوحة الخدمة: المسارين متزامنين (200 مباشر، مفيش 202 ولا استطلاع).
 * الرد بيتكتب في مفتاح التفاصيل عشان نموذج التعديل المبني على id:revision يتبني من جديد بالنسخة الجديدة،
 * وبتتلمس قائمة الخدمات وجذر تصنيفات النشاط لأن عدد الخدمات المفتوحة في التصنيف اتغير.
 */
export function useServiceClosing(
  companyId: string,
  businessId: string,
  userId: string,
  serviceId: string,
) {
  const client = useQueryClient();
  const detailKey = [...servicesKey(companyId, businessId, userId), 'detail', serviceId] as const;
  return useMutation({
    mutationKey: [...detailKey, 'closing'],
    retry: false,
    mutationFn: (input: ServiceClosingInput) => run(companyId, businessId, serviceId, input),
    onSuccess: async (saved) => {
      // إلغاء أي قراءة تفاصيل قديمة لسه شغالة الأول، عشان ما تطبقش رد قديم فوق النسخة المحفوظة.
      await client.cancelQueries({ queryKey: detailKey });
      client.setQueryData(detailKey, saved);
      void client.invalidateQueries({
        queryKey: [...servicesKey(companyId, businessId, userId), 'list'],
      });
      void client.invalidateQueries({
        queryKey: serviceCategoryKey(companyId, businessId, userId),
      });
    },
    onError: (error) => {
      if (refreshesDetail(error)) void client.invalidateQueries({ queryKey: detailKey });
    },
  });
}
