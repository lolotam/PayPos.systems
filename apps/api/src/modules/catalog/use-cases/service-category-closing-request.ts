import {
  SERVICE_CATEGORY_CLOSING_DEADLINE_MS,
  type ServiceCategoryClosingPending,
  type ServiceCategoryClosingRequested,
} from '@pospay/contracts';

import type { IdGenerator } from '../../../shared/ports/id-generator.port.ts';
import { ServiceCategoryError } from '../domain/errors.ts';
import {
  decideServiceCategoryClosingPending,
  serviceCategoryClosingDeadline,
  type NewServiceCategoryClosing,
  type ServiceCategoryClosingIntent,
  type ServiceCategoryClosingPendingDecision,
} from '../domain/service-category-closing-path.ts';
import { SERVICE_CATEGORY_CLOSING_REQUESTED } from '../events/published.ts';
import type { ServiceCategoryScope } from '../ports/service-category-transactions.port.ts';

/** نتيجة القبول في الخلفية: الطلب اتقبل وشغّال، والتصنيف لسه ما اتغيّرش. */
export interface ServiceCategoryClosingPendingOutcome {
  readonly kind: 'pending';
  readonly result: ServiceCategoryClosingPending;
}

/**
 * يقرأ الطلب المعلق على التصنيف ويقرّر مصيره: الطلب المطابق يُعاد بنفس هويته، والطلب
 * المنتهي يُنهى فيرفع الحجب عن التصنيف، والطلب المختلف يُرفض بأنه شغّال بالفعل.
 * الفحص يجري على المسارين مع بعض: طلب متزامن أثناء مهمة شغّالة يرفض برضه.
 *
 * @param scope      نطاق المعاملة الجاري
 * @param businessId النشاط المالك
 * @param categoryId التصنيف المطلوب
 * @param intent     الطلب الجديد: الفعل والنسخة والعدد
 * @param now        اللحظة المحقونة اللي يُقاس بها الموعد النهائي
 * @returns القرار: لا طلب، أو إعادة تشغيل، أو انتهاء، أو تعارض
 */
export async function resolvePendingClosing(
  scope: ServiceCategoryScope,
  businessId: string,
  categoryId: string,
  intent: ServiceCategoryClosingIntent,
  now: Date,
): Promise<ServiceCategoryClosingPendingDecision> {
  const pending = await scope.findPendingClosing(businessId, categoryId);
  const decision = decideServiceCategoryClosingPending(pending, intent, now);
  if (decision.kind === 'expired') await scope.expireClosing(decision.closing_id, now);
  return decision;
}

/**
 * يحوّل قرار الطلب المعلّق إلى نتيجة القبول أو إلى رفض: الطلب المطابق يُعاد بنفس هويته
 * فالنتيجة «معلّق» تانية، والطلب المختلف يُرفض بأنه شغّال بالفعل ومعاه هويته.
 *
 * @param decision القرار اللي طلع من فحص الطلب المعلّق
 * @returns نتيجة القبول في الخلفية، أو null لما يبقى الطلب معلّق جديد
 * @throws ServiceCategoryError لما يكون التصنيف شغّال بطلب تاني
 */
export function pendingClosingOutcome(
  decision: ServiceCategoryClosingPendingDecision,
): ServiceCategoryClosingPendingOutcome | null {
  if (decision.kind === 'replay')
    return { kind: 'pending', result: { closing_id: decision.closing_id, status: 'pending' } };
  if (decision.kind === 'in_progress')
    throw new ServiceCategoryError('SERVICE_CATEGORY_CLOSING_IN_PROGRESS', {
      closing_id: decision.closing_id,
    });
  return null;
}

/**
 * يقبل قفل أو فتح تصنيف في الخلفية: يكتب صف الطلب وحدثه في نفس المعاملة، والتصنيف
 * وخدماته ما يتغيّروش. هوية الطلب والموعد النهائي بيتحسبوا هنا عشان القفل والفتح
 * يفضلوا على نفس القاعدة وما يختلفوش في الحساب.
 *
 * @param scope   نطاق المعاملة الجاري
 * @param ids     مولّد الهوية
 * @param request بيانات الطلب: النشاط والتصنيف والفعل والنسخة والعدد والطالب واللحظة
 * @returns نتيجة القبول في الخلفية ومعها هوية الطلب المعلّق
 */
export async function requestServiceCategoryClosing(
  scope: ServiceCategoryScope,
  ids: IdGenerator,
  request: Omit<NewServiceCategoryClosing, 'id' | 'deadline_at'>,
): Promise<ServiceCategoryClosingPendingOutcome> {
  const closingId = ids.newId();
  await scope.createClosing({
    ...request,
    id: closingId,
    deadline_at: serviceCategoryClosingDeadline(
      request.requested_at,
      SERVICE_CATEGORY_CLOSING_DEADLINE_MS,
    ),
  });
  await scope.outbox.append({
    aggregateType: 'service_category_closing',
    aggregateId: closingId,
    eventType: SERVICE_CATEGORY_CLOSING_REQUESTED,
    payload: { closing_id: closingId } satisfies ServiceCategoryClosingRequested,
  });
  return { kind: 'pending', result: { closing_id: closingId, status: 'pending' } };
}
