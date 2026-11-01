import type { PageSettlement, RetrySettlement } from '../domain/rating-claim-scheduling.ts';

/**
 * كود نتيجة أمر على حالة الجدولة. كل كود بيقول للمجدول الخطوة الجاية: BUSY
 * معناها فيه مالك تاني، STALE معناها السور قديم فلازم تقرأ تاني، LIMIT معناها
 * حد اتقفل، وOVERFLOW معناها خريطة الإعادة امتلأت.
 */
export type ClaimStateCode = 'OK' | 'BUSY' | 'STALE' | 'MISSING' | 'CORRUPT' | 'LIMIT' | 'OVERFLOW';

/** سور التعديل: الشركة والنسخة ورقم النسخة ومالك الدور. */
export interface ClaimStateFence {
  /** الشركة المالكة للحالة. */
  readonly companyId: string;
  /** نسخة الحالة؛ بتتغير لما الحالة تتشال وتتعمل من جديد. */
  readonly incarnation: string;
  /** رقم النسخة المتوقع وقت التعديل. */
  readonly expectedVersion: number;
  /** رمز مالك الدور الحالي. */
  readonly ownerToken: string;
}

/** نتيجة أمر واحد: الكود ورقم النسخة، والقيمة لما الأمر يبقى له قيمة. */
export interface ClaimStateResult<Value = undefined> {
  /** الكود اللي بيحدد الخطوة الجاية. */
  readonly code: ClaimStateCode;
  /** رقم النسخة بعد الأمر. */
  readonly version: number;
  /** القيمة المرجعة، موجودة بس في الأوامر اللي بترجع حالة أو حجز. */
  readonly value?: Value;
}

/** طلب في خريطة الإعادة: وقت استحقاق إعادة النظر والتذكرة ومالك الحجز. */
export interface ClaimStateRetry {
  /** أول لحظة ينفع فيها إعادة النظر، بالمللي ثانية من حقبة Unix. */
  readonly eligibleAt: number;
  /** رقم التذكرة؛ أصغر تذكرة هي الأقدم. */
  readonly ticket: number;
  /** رمز الشغل المحجوز، ومفيش حجز لو الحقل مش موجود. */
  readonly workToken?: string;
  /** مالك الحجز، ومفيش حجز لو الحقل مش موجود. */
  readonly ownerToken?: string;
  /** نهاية حجز الطلب، ومفيش حجز لو الحقل مش موجود. */
  readonly leaseUntil?: number;
}

/** بند واحد في صفحة الجولة الأمامية. */
export interface ClaimStatePageEntry {
  /** معرّف طلب التقييم. */
  readonly requestId: string;
  /** رمز الشغل الطازج اللي اتحقن وقت تسجيل الصفحة. */
  readonly workToken: string;
}

/** صفحة واحدة مسجّلة: الطلبات اللي اتسجلت ورموز شغلها. */
export interface ClaimStatePage {
  /** معرّف الصفحة. */
  readonly pageId: string;
  /** معرّف الجولة اللي الصفحة بتاعتها. */
  readonly sweepId: string;
  /** الحد الأدنى للصفحة، وهو المؤشر اللي كانت الصفحة الجاية هتبدأ بعده. */
  readonly fromId?: string;
  /** آخر معرّف في الصفحة. */
  readonly throughId?: string;
  /** هل الصفحة دي آخر صفحة في الجولة. */
  readonly exhausted: boolean;
  /** طلبات الصفحة. */
  readonly entries: readonly ClaimStatePageEntry[];
}

/** لقطة الحالة كما يراها المجدول، وبتستخدمها لما رد الأمر يضيع. */
export interface ClaimStateSnapshot {
  /** الشركة المالكة للحالة. */
  readonly companyId: string;
  /** نسخة الحالة. */
  readonly incarnation: string;
  /** رقم النسخة. */
  readonly version: number;
  /** مالك الدور الحالي، ومفيش مالك لو الدور اتسيب. */
  readonly ownerToken?: string;
  /** نهاية حجز المالك. */
  readonly leaseUntil?: number;
  /** بداية الدور الحالي. */
  readonly turnStartedAt?: number;
  /** رقم التذكرة الجاي. */
  readonly nextTicket: number;
  /** هل الجولة الأمامية شغالة. */
  readonly phase: 'IDLE' | 'SWEEP';
  /** معرّف الجولة الأمامية الشغالة. */
  readonly sweepId?: string;
  /** الحد الأعلى المقطوع وقت بداية الجولة. */
  readonly upperId?: string;
  /** آخر معرّف اتزار. */
  readonly cursorId?: string;
  /** الصفحة المسجّلة. */
  readonly page?: ClaimStatePage;
  /** طلبات إعادة المحاولة، مفتاحها معرّف الطلب. */
  readonly retries: Readonly<Record<string, ClaimStateRetry>>;
  /** عدد مرات الفيضان بالتراكم. */
  readonly overflowCount: number;
  /** أول فيضان من وقت ما الحالة اتعملت؛ مش بيتصفّر غير لما الحالة تتعمل من جديد. */
  readonly overflowSince?: number;
  /** هل لازم جولة كاملة تعمل مصالحة. */
  readonly reconcileRequired: boolean;
  /** آخر جولة كاملة اتقفلت، حتى لو اتقفلت وفيها فيضان. */
  readonly lastCompletedSweepId?: string;
}

/** نتيجة حجز إعادات المحاولة: الطلبات المحجوزة ورموز شغلها. */
export interface ClaimStateReservations {
  /** الطلبات المحجوزة. */
  readonly reservations: readonly { readonly requestId: string; readonly workToken: string }[];
}

/** منفذ حالة الجدولة: كل تعديل متسور برقم النسخة ورمز المالك. */
export interface RatingClaimState {
  /**
   * يستلم ملكية الدور: بيعمل الحالة لو مش موجودة، ولو موجودة بيرفض المالك الحي
   * ويأخذ غيرها بس بتحديث النسخة. المجدول بيحتاج الكود عشان يعرف هل كمّل ولا خرج.
   *
   * @param companyId الشركة المالكة للحالة
   * @param newIncarnation نسخة جديدة تُستخدم بس لو الحالة مش موجودة
   * @param ownerToken رمز المالك الجديد اللي بيتحقن من مولّد المعرفات
   * @returns النتيجة واللقطة، واللقطة فيها السور اللي كل الأوامر بعدها بتستخدمه
   */
  acquire(
    companyId: string,
    newIncarnation: string,
    ownerToken: string,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يجدّد حجز المالك، وبس لحد سقف ملكية الدور. المجدول بيحتاجه عشان يفضل مالك
   * طول الدور من غير ما حد تاني ياخد الحالة.
   *
   * @param fence سور المالك الحالي
   * @returns النتيجة واللقطة بعد التجديد
   */
  renew(fence: ClaimStateFence): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يسيب الدور: بيرفع ملكية المالك من غير ما يمس التقدم ولا خريطة الإعادة.
   * المجدول بيناديه عشان الدور يقفل نظيف.
   *
   * @param fence سور المالك الحالي
   * @returns النتيجة واللقطة بعد التسليم
   */
  release(fence: ClaimStateFence): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يبدأ الجولة الأمامية ويقطّع الحد الأعلى مرة واحدة. المجدول بيحتاجها عشان
   * يمشي على حدود ثابتة من غير ما يمدد الجولة.
   *
   * @param fence سور المالك الحالي
   * @param sweepId معرّف الجولة الحالية
   * @param upperId أكبر معرّف ظاهر للشركة، أو null لما الشركة فاضية
   * @returns النتيجة واللقطة بعد البداية
   */
  begin(
    fence: ClaimStateFence,
    sweepId: string,
    upperId: string | null,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يسجّل صفحة كاملة ويقدّم المؤشر لآخر معرّف فيها. المجدول بيحتاجها عشان
   * يضمن إن أي مطالبة ليها صف مسجّل فعلاً.
   *
   * @param fence سور المالك الحالي
   * @param sweepId معرّف الجولة الحالية
   * @param fromId الحد الأدنى للصفحة، وهو المؤشر اللي قبلها
   * @param pageId معرّف الصفحة
   * @param entries طلبات الصفحة ورموز شغلها الطازجة
   * @param exhausted هل الصفحة دي آخر الجولة
   * @param maxEntries ميزانية الدور الأمامية، وهي أقصى عدد بنود الصفحة المسموح؛
   *   ولما ما تتحدّدش، الحد الافتراضي في الـ domain هو المرجع
   * @returns النتيجة واللقطة بعد التسجيل
   */
  enrollPage(
    fence: ClaimStateFence,
    sweepId: string,
    fromId: string | null,
    pageId: string,
    entries: readonly ClaimStatePageEntry[],
    exhausted: boolean,
    maxEntries?: number,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يحجز إعادات المحاولة المستحقة، الأقدم تذكرة الأول. المجدول بيحتاجها عشان
   * يمشي على مسار الإعادة بميزانية مستقلة عن المسار الأمامي.
   *
   * @param fence سور المالك الحالي
   * @param limit أقصى عدد حجوزات في الدور
   * @param workTokens رموز شغل طازجة، واحد لكل حجز
   * @returns النتيجة وقائمة الحجوزات
   */
  reserveRetries(
    fence: ClaimStateFence,
    limit: number,
    workTokens: readonly string[],
  ): Promise<ClaimStateResult<ClaimStateReservations>>;
  /**
   * يسوّي بند من صفحة الجولة الأمامية وبيشيله من الصفحة. المجدول بيحتاجها عشان
   * يقرر هل الطلب محتاج إعادة محاولة ولا خلص.
   *
   * @param fence سور المالك الحالي
   * @param pageId معرّف الصفحة اللي فيها البند
   * @param workToken رمز الشغل اللي بيحدد البند بالظبط
   * @param settlement تسوية البند
   * @param storedDueAt موعد الاستحقاق المخزن في الصف، أو null
   * @returns النتيجة واللقطة بعد التسوية
   */
  settlePage(
    fence: ClaimStateFence,
    pageId: string,
    workToken: string,
    settlement: PageSettlement,
    storedDueAt?: Date | null,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يسوّي طلب في خريطة الإعادة. المجدول بيحتاجها عشان يفضل الطلب محجوز لحد
   * ما يتأكد من نتيجته في القاعدة.
   *
   * @param fence سور المالك الحالي
   * @param requestId معرّف طلب التقييم
   * @param workToken رمز الشغل اللي بيحجز الطلب
   * @param settlement تسوية الطلب
   * @param storedDueAt موعد الاستحقاق المخزن في الصف، أو null
   * @returns النتيجة واللقطة بعد التسوية
   */
  settleRetry(
    fence: ClaimStateFence,
    requestId: string,
    workToken: string,
    settlement: RetrySettlement,
    storedDueAt?: Date | null,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يقفل الجولة الأمامية ويرجّع الحالة للـ IDLE مع حفظ الإعادات. المجدول
   * بيحتاجها عشان الجولة الجاية تبدأ من الحد الأعلى الجديد.
   *
   * @param fence سور المالك الحالي
   * @param sweepId معرّف الجولة اللي بتتقفل
   * @returns النتيجة واللقطة بعد الإقفال
   */
  finish(fence: ClaimStateFence, sweepId: string): Promise<ClaimStateResult<ClaimStateSnapshot>>;
  /**
   * يقرأ الحالة من غير أي تعديل: بيرجّع نسخة الحالة ورقمها والجولة الجارية
   * وخريطة الإعادة زي ما هي مخزّنة.
   *
   * مفيش أمر تاني في الإنتاج بيعتمد عليها؛ دي طريق المراقبة والاختبارات عشان
   * يشوفوا حالة الشركة من برّه من غير ما يغيّروها.
   *
   * @param companyId الشركة المالكة للحالة
   * @returns النتيجة واللقطة، أو كود خطأ لما الحالة مش موجودة أو تالفة
   */
  read(companyId: string): Promise<ClaimStateResult<ClaimStateSnapshot>>;
}
