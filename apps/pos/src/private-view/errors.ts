/** رد مرفوض من مسار العرض الخاص: الحالة وكود الخطأ بس، من غير أي بيانات خاصة. */
export class PrivateViewHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/** النافذة الخاصة انتهت: الجلسة لسه عايشة وشاشة الـ PIN هي اللي تظهر (D-A13). */
export function windowExpired(error: unknown): boolean {
  return (
    error instanceof PrivateViewHttpError &&
    error.status === 403 &&
    error.code === 'PRIVATE_VIEW_EXPIRED'
  );
}

/** الجلسة نفسها اتقفلت: أي 401 بتخرّج الموظفة من الشاشة الخاصة كلها. */
export function sessionEnded(error: unknown): boolean {
  return error instanceof PrivateViewHttpError && error.status === 401 && error.code !== 'PIN_INVALID';
}

/** الشهر خارج نافذة `staff_months_back` اللي المنشأة ضابطها (MY-13). */
export function monthOutOfRange(error: unknown): boolean {
  return error instanceof PrivateViewHttpError && error.code === 'MY_PERIOD_OUT_OF_RANGE';
}

/** رفض صريح للصلاحية (مش انتهاء نافذة): الصفحة مش متاحة ليها. */
export function viewForbidden(error: unknown): boolean {
  return error instanceof PrivateViewHttpError && error.status === 403 && !windowExpired(error);
}

/** ما يعمله جهاز الاستقبال لما قراءة أو لمسة على النافذة الخاصة بتترفض بصلاحية. */
export type WindowRefusal = 'leave' | 'expired' | 'refused';

/**
 * تصنيف رد مرفوض على قراءة أو لمسة جوّا نافذة جهاز الاستقبال، في مكان واحد.
 * أي 401 بيخرّج الموظفة، وأي 403 بيقفل النافذة كلها (انتهاء النافذة بسببه الخاص، وأي صلاحية تانية بـ «refused»).
 * الشهر خارج الحد (422) وأعطال النقل والسيرفر مبتتصنفش هنا: بتفضل جوّا النافذة.
 *
 * @param error الخطأ اللي رجع من الطلب
 * @returns التصرف المطلوب، أو null لو الخطأ مش رفض صلاحية
 */
export function windowRefusal(error: unknown): WindowRefusal | null {
  if (!(error instanceof PrivateViewHttpError) || monthOutOfRange(error)) return null;
  if (error.status === 401) return 'leave';
  if (error.status === 403) return windowExpired(error) ? 'expired' : 'refused';
  return null;
}
