import { sumMoney, type Money } from '@pospay/domain';

import { PackageRuleError } from './errors.js';
import { validatePackageDefinition, validatePackagePrice } from './package-definition.js';

/** المستعمل المستورد والمسترد ما ينفعش يدخلوا ضمن الجلسات المتاحة. */
export type PackageSlotState = 'FREE' | 'USED' | 'REFUNDED' | 'IMPORTED_USED';

/** لقطة جلسة واحدة من مكون واحد؛ redemptionId هو الاستخدام الحالي وليس آخر استخدام تاريخي. */
export interface PackageSlot {
  readonly ordinal: number;
  readonly unitValue: Money;
  readonly state: PackageSlotState;
  readonly redemptionId?: string;
}

/** لقطة الاسترداد المقترح فقط؛ الكتابة والأقفال مسؤولية use case اللاحق. */
export interface PackageRefundSelection {
  readonly ordinals: readonly number[];
  readonly amount: Money;
}

/**
 * بيثبت قيم الجلسات على العدد الأصلي؛ آخر ordinal بياخد باقي القسمة كله (§8).
 * الاستيراد بيعلّم أول جلسات مستهلكة من غير إعادة تقييم المتبقي.
 *
 * @param componentValue قيمة المكون بالفلوس
 * @param sessions عدد الجلسات الأصلي
 * @param remainingSessions المتبقي في الاستيراد؛ افتراضياً كل الجلسات حرة
 * @returns جلسات مرتبة من 1 للعدد الأصلي، بنفس القيمة للباقة الجديدة والمستوردة
 */
export function createPackageSlots(
  componentValue: Money,
  sessions: number,
  remainingSessions: number = sessions,
): PackageSlot[] {
  validatePackageDefinition(componentValue, [
    { serviceId: 'component', sessions, remainingSessions },
  ]);
  const count = BigInt(sessions);
  const baseValue = componentValue / count;
  const remainder = componentValue % count;
  const importedUsed = sessions - remainingSessions;
  return Array.from({ length: sessions }, (_, index) => {
    const ordinal = index + 1;
    return {
      ordinal,
      unitValue: baseValue + (ordinal === sessions ? remainder : 0n),
      state: ordinal <= importedUsed ? 'IMPORTED_USED' : 'FREE',
    };
  });
}

function freeSlots(slots: readonly PackageSlot[]): PackageSlot[] {
  const seen = new Set<number>();
  for (const slot of slots) {
    if (!Number.isSafeInteger(slot.ordinal) || slot.ordinal < 1 || seen.has(slot.ordinal)) {
      throw new PackageRuleError('INVALID_SLOTS');
    }
    seen.add(slot.ordinal);
    validatePackagePrice(slot.unitValue);
  }
  return slots.filter((slot) => slot.state === 'FREE');
}

/**
 * بيختار أقل FREE ordinal عشان إلغاء الاستخدام يعيد نفس الجلسة لمكانها في الدور.
 *
 * @param slots لقطة جلسات مكون واحد تحت قفل المستهلك
 * @returns نسخة الجلسة المختارة؛ نفاد الجلسات بيترفض بخطأ مسمّى
 */
export function selectPackageRedemptionSlot(slots: readonly PackageSlot[]): PackageSlot {
  const selected = freeSlots(slots).sort((a, b) => a.ordinal - b.ordinal)[0];
  if (selected === undefined) throw new PackageRuleError('INSUFFICIENT_SLOTS');
  return { ...selected };
}

/**
 * بيختار العدد المطلوب بالضبط من أعلى FREE ordinals ويجمع قيمها المخزنة (§8).
 * الرفض قبل أي تغيير يمنع استرداد جزء من طلب أكبر من المتاح.
 *
 * @param slots لقطة جلسات مكون واحد تحت قفل المستهلك
 * @param sessions عدد صحيح موجب من الجلسات المطلوب استردادها
 * @returns ordinals تنازلياً ومبلغها الدقيق بالفلوس
 */
export function selectPackageRefundSlots(
  slots: readonly PackageSlot[],
  sessions: number,
): PackageRefundSelection {
  if (!Number.isSafeInteger(sessions) || sessions < 1) {
    throw new PackageRuleError('INVALID_SESSIONS');
  }
  const available = freeSlots(slots).sort((a, b) => b.ordinal - a.ordinal);
  if (available.length < sessions) throw new PackageRuleError('INSUFFICIENT_SLOTS');
  const selected = available.slice(0, sessions);
  return {
    ordinals: selected.map((slot) => slot.ordinal),
    amount: sumMoney(selected.map((slot) => slot.unitValue)),
  };
}

/**
 * بيسمح بالعكس مرة واحدة ولصاحب الاستخدام الحالي فقط؛ retry قديم ما يحررش جلسة اتاخدت تاني.
 *
 * @param slot لقطة الجلسة الحالية
 * @param redemptionId هوية الاستخدام المراد عكسه
 * @param alreadyReversed هل الاستخدام اتعكس قبل كده
 * @returns هل الاستخدام غير معكوس والجلسة لسه USED بنفس هويته
 */
export function canReversePackageRedemption(
  slot: PackageSlot,
  redemptionId: string,
  alreadyReversed: boolean,
): boolean {
  return !alreadyReversed && slot.state === 'USED' && slot.redemptionId === redemptionId;
}
