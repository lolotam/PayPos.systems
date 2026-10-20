import type { LineEditPerformer } from './line-edit-identity.ts';
import { assertActorIsNotPerformer } from './line-mutation-shared.ts';

/** هويات المنفّذات الثلاث التي تحظر على المستخدمة نفسها الكتابة على السطر. */
export interface LinePerformersIdentity {
  current: readonly LineEditPerformer[];
  retained: readonly LineEditPerformer[];
  requested: readonly LineEditPerformer[];
}

/**
 * يمنع صاحبة التغيير من الكتابة على سطر هي منفّذته الآن أو كانت منفّذته أو ستنضم إليه.
 * القاعدة نفسها التي تمنع التعديل على السطر هي المستخدمة هنا، فلا ينشأ حكم ثانٍ ولا جملة جديدة.
 * الهوية المجمّعة تضم المنفّذات الحالية والمتبقية من تاريخ السطر والمطلوبة في الطلب.
 *
 * @param changerUserId مستخدمة صاحبة التغيير
 * @param identities هوية المنفّذات الحالية والمتبقية والمطلوبة
 * @returns لا شيء؛ التطابق أو غياب اللقطة يرفض
 */
export function assertChangerIsNotPerformer(
  changerUserId: string,
  identities: LinePerformersIdentity,
): void {
  assertActorIsNotPerformer(changerUserId, [
    ...identities.current,
    ...identities.retained,
    ...identities.requested,
  ]);
}

/**
 * يبني هوية المنفّذة المطلوبة من ربطها الحالي، بلا لقطة تسجيل لأنها لم تُسجَّل على السطر.
 * الموظفة غير الموجودة تعطي ربطاً فارغاً؛ لا يُخمَّن مستخدم ولا يُخمَّن سبب.
 *
 * @param requestedEmployeeIds معرّفات الموظفات المطلوبة بترتيب الطلب
 * @param currentLinks الموظفات الموجودة وقت القراءة وربطها الحالي
 * @returns هوية كل موظفة مطلوبة، والربط الحالي null إن لم تُوجد
 */
export function requestedPerformerIdentities(
  requestedEmployeeIds: readonly string[],
  currentLinks: readonly { id: string; user_id: string | null }[],
): LineEditPerformer[] {
  return requestedEmployeeIds.map((employeeId) => ({
    linked_user_id: null,
    linked_user_snapshotted: true,
    current_user_id: currentLinks.find((link) => link.id === employeeId)?.user_id ?? null,
  }));
}
