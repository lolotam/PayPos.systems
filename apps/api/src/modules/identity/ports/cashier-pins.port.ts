import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/**
 * القرايات والكتابات بتاعة PINs الكاشير جوه transaction واحدة في الشركة.
 */
export interface CashierPinScope {
  readonly audit: AuditTrail;
  /**
   * الـ hash المتخزن للموظف ده في الشركة دي، أو null لو مالوش PIN — الـ use case بيقارن بيه.
   *
   * @param employeeId الموظف
   */
  findHash(employeeId: string): Promise<string | null>;
  /**
   * بيحفظ الـ hash الجديد مكان القديم لو موجود؛ بيرجّع هل ده أول PIN للموظف عشان الـ audit يفرّق.
   *
   * @param pin الموظف والـ hash ومين حطه وإمتى
   * @param pin.employeeId الموظف
   * @param pin.pinHash    الـ hash من packages/auth
   * @param pin.setBy      المدير اللي حطه
   * @param pin.setAt      لحظة التغيير
   */
  save(pin: {
    employeeId: string;
    pinHash: string;
    setBy: string;
    setAt: Date;
  }): Promise<'created' | 'replaced'>;
}

/**
 * بيفتح withTenant في شركة الـ PIN — الشركة جاية من الـ principal المتأكد منه، مش من الطلب.
 */
export interface CashierPinTransactions {
  /**
   * @param companyId الشركة
   * @param userId    المدير اللي بيغيّر، أو null لما الجهاز هو اللي بيتأكد من PIN
   * @param work      الشغل جوه الـ transaction
   */
  run<T>(
    companyId: string,
    userId: string | null,
    work: (scope: CashierPinScope) => Promise<T>,
  ): Promise<T>;
}

/**
 * الـ hash بتاع الـ PIN — الـ adapter بينادي packages/auth، الوحيد اللي بيعمل hash لـ PIN (CLAUDE.md §8).
 */
export interface PinHasher {
  /**
   * hash بملح جديد، هو اللي بيتخزن بدل الـ PIN.
   *
   * @param pin الـ PIN بعد ما اتأكدنا من شكله
   */
  hash(pin: string): Promise<string>;
  /**
   * مقارنة constant-time، وبنفس الوقت تقريباً لو مفيش hash — عشان الوقت ما يقولش مين عنده PIN.
   *
   * @param pin    الـ PIN اللي جه في الطلب
   * @param stored الـ hash المتخزن أو null
   */
  verify(pin: string, stored: string | null): Promise<boolean>;
}

/**
 * الموظف اللي بنعد محاولاته، جوه شركته.
 */
export interface PinTarget {
  readonly companyId: string;
  readonly employeeId: string;
}

/**
 * عدّادات محاولات الـ PIN لكل موظف في Redis (CLAUDE.md §8) — القفل لازم يبان لكل الـ API instances، وكل عملية ذرّية
 * عشان الطلبات اللي بتيجي مع بعض ما تعدّيش الحد ولا تمسح قفل أحدث منها.
 */
export interface PinAttempts {
  /**
   * بيحجز مكان لمقارنة قبل ما تبدأ، بـ id ومدة خاصة بيه: 'locked' لو مقفول، و'busy' لو الغلطات + الحجوزات الشغالة
   * وصلوا 5 — فمفيش أكتر من 5 غلطات ممكنة قبل القفل مهما جت طلبات مع بعض.
   *
   * @param target الشركة والموظف
   */
  reserve(
    target: PinTarget,
  ): Promise<{ kind: 'ok'; reservation: string } | { kind: 'locked' } | { kind: 'busy' }>;
  /**
   * بيسجل غلطة ويقفل الحجز؛ الغلطة الخامسة في الـ window بتعمل قفل ليه 15 دقيقة خاصة بيه، ومبتطوّلش قفل موجود.
   * 'expired' لو الحجز خلص قبل ما المقارنة تخلص — ساعتها مفيش حاجة بتتغير.
   *
   * @param target      الشركة والموظف
   * @param reservation الحجز اللي reserve رجّعه
   */
  failed(target: PinTarget, reservation: string): Promise<'failed' | 'locked' | 'expired'>;
  /**
   * بيقفل الحجز ويمسح الغلطات بعد PIN صح. 'locked' لو فيه قفل دلوقتي — PIN صح ما ينفعش وهو مقفول — و'expired' لو
   * الحجز خلص؛ في الحالتين الـ PIN ما بيتحسبش.
   *
   * @param target      الشركة والموظف
   * @param reservation الحجز اللي reserve رجّعه
   */
  succeeded(target: PinTarget, reservation: string): Promise<'ok' | 'locked' | 'expired'>;
  /**
   * بيقفل الحجز من غير ما يعد غلطة — لما المقارنة ما كملتش بسبب خطأ مش بسبب PIN.
   *
   * @param target      الشركة والموظف
   * @param reservation الحجز اللي reserve رجّعه
   */
  release(target: PinTarget, reservation: string): Promise<void>;
}
