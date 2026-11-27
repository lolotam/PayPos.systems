/**
 * بوابة التزامن المشتركة لمقارنات الرقم السري داخل نفس عملية الـ API:
 * دخول الموظفة وفتح العرض الخاص واعتماد الخصم بالـ PIN بيشاركوا نفس السقف.
 */
export interface StaffPinComparisonGate {
  /**
   * يحجز مقعداً واحداً لو السقف لسه ما اكتملش، أو يرجع null عند امتلاء السقف.
   *
   * @returns دالة تحرير المقعد مرة واحدة، أو null لو مفيش مقعد فاضي
   */
  acquire(): (() => void) | null;
}

/**
 * ينشئ عداد تزامن واحداً بسقف محدد، وتحرير المقعد فيه آمن ضد التكرار حتى لو اتندى أكتر من مرة.
 *
 * @param limit الحد الأقصى للمقارنات المتزامنة داخل العملية
 * @returns البوابة المشتركة
 */
export function createStaffPinComparisonGate(limit: number): StaffPinComparisonGate {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('STAFF_PIN_GATE_LIMIT_INVALID');
  }
  let active = 0;
  return {
    acquire() {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}
