import type { StaffPinComparisonGate } from '../ports/staff-pins.port.ts';

/**
 * ينشئ بوابة تزامن عملية واحدة مشتركة بين مسارات مقارنة الـ PIN (دخول الموظفة،
 * العرض الخاص، واعتماد الخصم بالـ PIN) حتى لا يتجاوز إجمالي مقارنات الـ PBKDF2 المتزامنة السقف.
 *
 * @param limit الحد الأقصى لمقارنات الـ PIN المتزامنة داخل العملية الواحدة (عدد صحيح موجب)
 * @returns بوابة تحجز خانة وتعيد دالة تحرير محصّنة ضد الاستدعاء المتكرر
 */
export function createStaffPinComparisonGate(limit: number): StaffPinComparisonGate {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('STAFF_PIN_GATE_LIMIT_INVALID');
  }
  let active = 0;
  return {
    acquire: () => {
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
