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
 * عدّاد محاولات الـ PIN لكل موظف في Redis (CLAUDE.md §8) — القفل لازم يبان لكل الـ API instances مع بعض.
 */
export interface PinAttempts {
  /**
   * بيحجز محاولة قبل المقارنة ويرجّع رقمها في الـ window الحالي (15 دقيقة من أول غلطة).
   *
   * @param companyId الشركة
   * @param employeeId الموظف
   */
  reserve(companyId: string, employeeId: string): Promise<number>;
  /**
   * بيبدأ الـ 15 دقيقة من اللحظة دي — بعد الغلطة الخامسة.
   *
   * @param companyId الشركة
   * @param employeeId الموظف
   */
  lock(companyId: string, employeeId: string): Promise<void>;
  /**
   * بيمسح العدّاد بعد PIN صح، فالغلطات القديمة ما تتجمعش مع اللي بعدها.
   *
   * @param companyId الشركة
   * @param employeeId الموظف
   */
  clear(companyId: string, employeeId: string): Promise<void>;
}
