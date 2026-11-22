/** رد مرفوض من مسارات «شغلي»: الحالة وكود الخطأ بس، من غير أي بيانات خاصة. */
export class WorkHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

/**
 * رد قراءة ناجح اترمى لأن نافذته مش الحالية (نافذة أحدث خدت مكانها أو موعدها فات) قبل ما يتنشر في الكاش.
 * مفيش بيانات فيه ولا كود سيرفر: الشاشة اتقفلت أصلاً بالفعل.
 */
export class PrivateViewRetiredError extends Error {
  constructor() {
    super('PRIVATE_VIEW_RETIRED');
  }
}

/** النافذة الخاصة انتهت: الجلسة لسه عايشة وشاشة الـ PIN هي اللي تظهر (D-A13). */
export function windowExpired(error: unknown): boolean {
  return (
    error instanceof WorkHttpError && error.status === 403 && error.code === 'PRIVATE_VIEW_EXPIRED'
  );
}

/** الجلسة نفسها اتقفلت: أي 401 بتخرّج الموظفة من الشاشة الخاصة كلها. */
export function sessionEnded(error: unknown): boolean {
  return error instanceof WorkHttpError && error.status === 401 && error.code !== 'PIN_INVALID';
}

/** الشهر خارج نافذة `staff_months_back` اللي المنشأة ضابطها (MY-13). */
export function monthOutOfRange(error: unknown): boolean {
  return error instanceof WorkHttpError && error.code === 'MY_PERIOD_OUT_OF_RANGE';
}

/** رفض صريح للصلاحية (مش انتهاء نافذة): الصفحة مش متاحة ليها. */
export function workForbidden(error: unknown): boolean {
  return error instanceof WorkHttpError && error.status === 403 && !windowExpired(error);
}
