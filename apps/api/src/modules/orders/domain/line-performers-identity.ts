import type { LineEditPerformer } from './line-edit-identity.ts';
import { assertActorIsNotPerformer } from './line-mutation-shared.ts';
import { SessionError } from './session-error.ts';

/** هويات المنفّذات التي تحظر على المستخدمة نفسها الكتابة على السطر: الحالية والمتبقية. */
export interface LinePerformersIdentity {
  current: readonly LineEditPerformer[];
  retained: readonly LineEditPerformer[];
}

/**
 * يمنع صاحبة التغيير من الكتابة على سطر هي منفّذته الآن أو كانت منفّذته أو ستنضم إليه.
 * القاعدة نفسها التي تمنع التعديل على السطر هي المستخدمة هنا، فلا ينشأ حكم ثانٍ ولا جملة جديدة.
 * السطر بلا منفّذين حاليّين يُرفض قبل المقارنة، لأن فراغاً لا يثبت هوية ولا يطابق أحداً.
 * الهوية المطلوبة لا يمرّرها المستدعي: تُشتق من حقائق الموظفات المضافات نفسها التي تُحفظ في السطر الجديد.
 *
 * @param changerUserId مستخدمة صاحبة التغيير
 * @param identities هوية المنفّذات الحالية والمتبقية
 * @param requested هوية المنفّذات المضافات، مشتقّة من حقائق الموظفات المضافات
 * @returns لا شيء؛ التطابق أو غياب اللقطة يرفض
 */
export function assertChangerIsNotPerformer(
  changerUserId: string,
  identities: LinePerformersIdentity,
  requested: readonly LineEditPerformer[] = [],
): void {
  if (identities.current.length === 0) throw new SessionError('SESSION_LINE_IDENTITY_UNKNOWN');
  assertActorIsNotPerformer(changerUserId, [
    ...identities.current,
    ...identities.retained,
    ...requested,
  ]);
}

/**
 * يبني نصف الرابط الحالي فقط للمنفّذات التي يضيفها التغيير، بلا لقطة تسجيل.
 * الباقية ليست هنا: لقطتها وربطها في الهوية الحالية، والمضافة تأخذ ربطها من حقائقها هي.
 * الموظفة الناقصة من الحقائق تعطي ربطاً فارغاً؛ لا يُخمَّن مستخدم.
 *
 * @param requestedEmployeeIds معرّفات الموظفات المضافات
 * @param addedEmployees حقائق الموظفات المضافات وربطها الحالي
 * @returns هوية كل موظفة مضافة، والربط الحالي null إن لم تُوجد
 */
export function requestedPerformerIdentities(
  requestedEmployeeIds: readonly string[],
  addedEmployees: readonly { id: string; user_id: string | null }[],
): LineEditPerformer[] {
  return requestedEmployeeIds.map((employeeId) => ({
    linked_user_id: null,
    linked_user_snapshotted: true,
    current_user_id: addedEmployees.find((employee) => employee.id === employeeId)?.user_id ?? null,
  }));
}
