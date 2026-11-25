import type {
  StaffAccessGrantAdmission,
  StaffAccessGrantSlot,
} from '../ports/staff-access-admission.port.ts';

/**
 * أقصى عدد منح جارية في العملية الواحدة مع بعض.
 * أربع منح بتاخد أربع اتصالات من pool الشركة (10) وأربع من pool الـ auth المحدود (8)،
 * فباقي الاتصالات يفضل الشغل العادي من غير ما يتزاحم المنح على نفسه.
 */
export const MAX_IN_FLIGHT_STAFF_ACCESS_GRANTS = 4;

/**
 * بوابة دخول المنح في العملية: منحة واحدة جارية لكل شركة، وأربع منح جارية على الأكثر في كل العملية.
 * المنح المتوازي لنفس الشركة كان بيحرق قفل صف الشركة لحد ما ينتهي على مهلة القفل ويرد 500؛
 * البوابة بترفض الطلب التاني فورًا بكود قابل لإعادة المحاولة من غير ما تفتح معاملة ولا اتصال auth.
 *
 * @returns البوابة اللي use case المنح بيستعملها قبل أول معاملة
 */
export function createStaffAccessGrantAdmission(): StaffAccessGrantAdmission {
  const inFlight = new Set<string>();
  // العَلَم لكل حصة: التحرير المكرر (أو تحرير قديم بعد ما الشركة رجعت تستقبل منحة جديدة) ما يشيلش
  // حصة المنحة الجارية الفعلية.
  const released = new WeakMap<StaffAccessGrantSlot, boolean>();
  return {
    admit: (companyId: string): StaffAccessGrantSlot | null => {
      if (inFlight.has(companyId)) return null;
      if (inFlight.size >= MAX_IN_FLIGHT_STAFF_ACCESS_GRANTS) return null;
      inFlight.add(companyId);
      return { companyId };
    },
    release: (slot: StaffAccessGrantSlot): void => {
      if (released.get(slot) === true) return;
      released.set(slot, true);
      inFlight.delete(slot.companyId);
    },
  };
}
