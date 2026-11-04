import { sumMoney, type Money } from '@pospay/domain';

import { assertPackageNotExpired } from './package-expiry.js';
import { selectPackageRefundSlots, type PackageSlot } from './package-slots.js';

/** حقائق مصرح بها ومقفولة؛ التواريخ والمبالغ والمراجعة والهويات متحقق منها عند المستهلك. */
export interface PackageRefundFacts {
  readonly provenance: 'SOLD' | 'IMPORTED';
  readonly importedRefundsEnabled: boolean;
  readonly today: string;
  readonly expiresOn: string;
  readonly slots: readonly PackageSlot[];
  readonly requestedSessions: number;
  readonly refundedAmount: Money;
  readonly revision: number;
}

/** نسخة صريحة لقيمة الجلسة المستردة؛ لا تحمل بيانات الاستخدام أو أي بيانات خاصة. */
export interface PackageRefundPlannedSlot {
  readonly ordinal: number;
  readonly unitValue: Money;
}

/** خطة حسابية فقط؛ شرط النشر يخص PackageSaleChanged ولا يمثل حدثاً منشوراً. */
export type PackageRefundPlan =
  | { readonly accepted: false; readonly code: 'IMPORTED_REFUNDS_DISABLED' }
  | {
      readonly accepted: true;
      readonly selectedSlots: readonly PackageRefundPlannedSlot[];
      readonly amount: Money;
      readonly newRefundedAmount: Money;
      readonly newRevision: number;
      readonly publicationRequired: boolean;
    };

/**
 * يخطط لاسترداد العدد الدقيق من أعلى الجلسات الحرة بقيمها المخزنة، حتى لو كانت صفراً.
 * المستهلك يتحقق من الصلاحية وCASH أو CARD والسبب الخاص المطلوب، ويقفل الاستحقاق ثم المكون.
 * يحفظ الاسترداد والجلسات والحالة والتدقيق والحدث المطلوب ذرياً؛ السبب يبقى في سجل الاسترداد فقط.
 * today هو تاريخ الفرع القائم بالفعل؛ لا ساعة أو تحويل أموال أو إثبات لتزامن الكتابة هنا.
 * publicationRequired يلزم نشر PackageSaleChanged للبيع فقط، ولا ينشئ هوية حدث أو محتواه.
 *
 * @param facts الحقائق المصرح بها تحت الأقفال، وسياسة المستورد المحسومة كقيمة boolean صريحة
 * @returns رفض المستورد المغلق دون خطة كتابة، أو نسخ الجلسات والمبلغ والحالة التالية وشرط النشر
 */
export function planPackageRefund(facts: PackageRefundFacts): PackageRefundPlan {
  if (facts.provenance === 'IMPORTED' && !facts.importedRefundsEnabled) {
    return { accepted: false, code: 'IMPORTED_REFUNDS_DISABLED' };
  }
  assertPackageNotExpired(facts.today, facts.expiresOn);
  const selection = selectPackageRefundSlots(facts.slots, facts.requestedSessions);
  const selectedSlots = facts.slots
    .filter((slot) => selection.ordinals.includes(slot.ordinal))
    .sort((a, b) => b.ordinal - a.ordinal)
    .map((slot) => ({ ordinal: slot.ordinal, unitValue: slot.unitValue }));
  return {
    accepted: true,
    selectedSlots,
    amount: selection.amount,
    newRefundedAmount: sumMoney([facts.refundedAmount, selection.amount]),
    newRevision: facts.revision + 1,
    publicationRequired: facts.provenance === 'SOLD',
  };
}
