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

/** رفض داخلي مؤجل حتى يلتزم انتهاء الطلب القديم قبل وصول الخطأ للعميل. */
export interface ServiceCategoryClosingRefusal {
  readonly kind: 'refused';
  readonly error: ServiceCategoryError;
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
 * يفحص الطلب المعلق قبل قفل التصنيف حتى يرد الطلب المطابق أو المتعارض فوراً أثناء عمل العامل.
 * القراءة بلا قفل ولا كتابة؛ إعادة الفحص بعد القفل تظل مسؤولة عن السباق وعن تسجيل الانتهاء.
 *
 * @param scope      نطاق المعاملة الجاري
 * @param businessId النشاط المالك
 * @param categoryId التصنيف المطلوب
 * @param intent     الطلب الجديد: الفعل والنسخة والعدد
 * @param now        اللحظة المحقونة اللي يُقاس بها الموعد النهائي
 * @returns نتيجة إعادة الطلب المطابق، أو null للطلب الجديد أو المنتهي
 * @throws ServiceCategoryError لما يكون التصنيف شغّال بطلب تاني
 */
export async function precheckPendingClosing(
  scope: ServiceCategoryScope,
  businessId: string,
  categoryId: string,
  intent: ServiceCategoryClosingIntent,
  now: Date,
): Promise<ServiceCategoryClosingPendingOutcome | null> {
  const pending = await scope.findPendingClosing(businessId, categoryId);
  return pendingClosingOutcome(decideServiceCategoryClosingPending(pending, intent, now));
}

/**
 * يحفظ رفض التحقق كقيمة فقط عندما سبقه تسجيل انتهاء طلب قديم، حتى تلتزم المعاملة
 * بدل ما يمحو الرفض أثر الانتهاء. أي رفض آخر يُرمى فوراً وتتراجع المعاملة كالمعتاد.
 *
 * @param decision   قرار الطلب المعلق بعد قفل التصنيف
 * @param validation فحص الحالة والنسخة والعدد فقط، من غير أي خطوة كتابة لاحقة
 * @returns نتيجة التحقق الناجح، أو الرفض الداخلي المؤجل بعد انتهاء الطلب القديم
 * @throws الخطأ الأصلي في كل حالة غير رفض تحقق مسمّى بعد قرار منتهي
 */
export async function closingValidationAfterExpiry<T>(
  decision: ServiceCategoryClosingPendingDecision,
  validation: () => Promise<T>,
): Promise<T | ServiceCategoryClosingRefusal> {
  try {
    return await validation();
  } catch (error) {
    if (decision.kind === 'expired' && error instanceof ServiceCategoryError)
      return { kind: 'refused', error };
    throw error;
  }
}

/**
 * يعيد رفض التحقق بعد نجاح التزام المعاملة، فيصل للعميل نفس الخطأ بينما يبقى أثر الانتهاء محفوظاً.
 *
 * @param outcome نتيجة العملية أو رفض التحقق الداخلي
 * @returns نتيجة العملية الأصلية بعد نجاحها
 * @throws ServiceCategoryError الرفض المؤجل بعد الالتزام
 */
export function rethrowClosingRefusal<T extends { readonly kind: string }>(
  outcome: T | ServiceCategoryClosingRefusal,
): T {
  if (outcome.kind === 'refused' && 'error' in outcome) throw outcome.error;
  return outcome as T;
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
