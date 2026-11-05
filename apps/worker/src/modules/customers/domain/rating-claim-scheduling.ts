/**
 * سياسة مجدول طلبات التقييم: ميزانيات الدور، وتسوية المصير، ووقت إعادة النظر.
 *
 * كل حاجة هنا دوال صافية: الوقت بيدخل من المتصل (الساعة المحقونة في الاختبار، أو
 * Redis TIME وقت التشغيل) والـ Redis نفسه مش موجود في الطبقة دي خالص.
 */

/** عدد الزيارات الأمامية المحجوزة لكل دور خدمة. */
export const FORWARD_VISITS = 75;

/** عدد زيارات إعادة المحاولة المحجوزة لكل دور خدمة. */
export const RETRY_VISITS = 25;

/** أقصى عدد طلبات إعادة المحاولة اللي حالة الشركة الواحدة بتحملها. */
export const RETRY_CAPACITY = 2048;

/** أقصى مدة انتظار بين إعادات النظر المتتالية لنفس الطلب. */
export const RETRY_BACKOFF_MS = 60_000;

/** أقصى عدد زيارات الدور الواحد، عشان ما يتجاوزش 100 زيارة في دور واحد. */
export const MAX_VISITS_PER_TURN = 100;

/** أقصى حجم للحالة المرمّزة بالبايت، قبل ما تسجيل الصفحة يتعطّل. */
export const STATE_MAX_BYTES = 1_048_576;

/** المساحة المحجوزة في حجم الحالة عشان تسجيل الصفحة الجاية ما يتأخرش بالإعادات. */
export const PAGE_RESERVE_BYTES = 65_536;

/** مدة حجز المالك في Redis. */
export const LEASE_MS = 120_000;

/** أقصى مدة ملكية الدور الواحد، وبعدها لازم دور جديد. */
export const MAX_TURN_MS = 180_000;

/** أقل مدة بين تجديد حجز المالك: ربع مدة الحجز. */
export const RENEWAL_INTERVAL_MS = LEASE_MS / 4;

/** ميزانية الدور: مسار أمامي للزيارات ومسار مستقل لإعادة المحاولة. */
export interface VisitBudget {
  /** عدد الصفوف الأمامية اللي الدور يقدر يزورها. */
  readonly forward: number;
  /** عدد إعادات المحاولة اللي الدور يقدر يخدمها. */
  readonly retry: number;
}

/**
 * بيتأكد إن ميزانية الدور جوه الحدود: مسارين موجبين، ومجموعهم ما يتجاوزش 100.
 * المساران ما بيستعيروش من بعض، فالدور بيخدم الأمامي والإعادة في نفس الوقت.
 *
 * @param budget الميزانية المطلوبة للدور
 * @returns نفس الميزانية بعد التحقق
 */
export function assertVisitBudget(budget: VisitBudget): VisitBudget {
  if (!Number.isSafeInteger(budget.forward) || budget.forward < 1) {
    throw new RangeError('VISIT_BUDGET_FORWARD_INVALID');
  }
  if (!Number.isSafeInteger(budget.retry) || budget.retry < 1) {
    throw new RangeError('VISIT_BUDGET_RETRY_INVALID');
  }
  if (budget.forward + budget.retry > MAX_VISITS_PER_TURN) {
    throw new RangeError('VISIT_BUDGET_TOTAL_EXCEEDED');
  }
  return budget;
}

/**
 * هل لازم يجدّد الدور حجزه؟
 *
 * حجز المالك في Redis بيبقى 120 ثانية، والتجديد بياخد ربع المدة بس. الحساب
 * بساعة المحقونة مش بساعة Redis، عشان القرار يبقى قابل للاختبار.
 *
 * @param now لحظة القرار المحقونة
 * @param lastRenewalAt آخر لحظة تجديد
 * @returns true لو عدّت مدة التجديد ولازم تجديد
 */
export function leaseRenewalDue(now: Date, lastRenewalAt: Date): boolean {
  return now.getTime() - lastRenewalAt.getTime() >= RENEWAL_INTERVAL_MS;
}

/** مصير طلب التقييم بعد ما جولة المطالبة خلصت عليه. */
export type ClaimSettlement =
  /** الطلب خلص ومايلوش لازمة تانية: اتبعت أو اتلغى أو اتنقل للإرسال. */
  | 'TERMINAL'
  /** الطلب مش موجود، والدوام ده مؤكَّد بالـ commit. */
  | 'ABSENT'
  /** الطلب لسه في المستقبل فاتحالوش مطالبة؛ الجولة الجاية هتلمه. */
  | 'FUTURE_UNATTEMPTED'
  /** الطلب اتحاول وفضل مجدول، فمحتاج إعادة محاولة. */
  | 'RETRY'
  /** الطلب أصله في خريطة الإعادة، فالجولة الجاية تتركه زي ما هو. */
  | 'DELEGATED';

/** التسويات اللي صفحة الجولة الأمامية هي اللي بتقبلها. */
export type PageSettlement = ClaimSettlement;

/** التسويات اللي مسار إعادة المحاولة هو اللي بيقبلها. */
export type RetrySettlement = Extract<ClaimSettlement, 'TERMINAL' | 'ABSENT' | 'RETRY'>;

/** حالة طلب التقييم اللي بيتقاس عليها التسوية. */
export type RatingRequestStatus = 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';

/**
 * المشاهدة بعد المطالبة: الحالة المقروءة في نفس المعاملة، أو غياب مؤكَّد، أو
 * صف ما اتحاولش أصلاً لأنه في المستقبل، أو نتيجة مجهولة.
 */
export type ClaimObservation =
  | { readonly kind: 'STATUS'; readonly status: RatingRequestStatus }
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'FUTURE_UNATTEMPTED' }
  | { readonly kind: 'UNKNOWN' };

/**
 * بيحوّل مشاهدة ما بعد المطالبة إلى تسوية.
 *
 * القاعدة الحاكمة: أي طلب لسه SCHEDULED بعد ما اتحاول يفضل قابل لإعادة المحاولة،
 * حتى لو سبب بقائه كان SKIPPED أو TOKEN_UNAVAILABLE أو NOT_DUE أو RESCHEDULED؛
 * والنتيجة المجهولة (خطأ أو commit مش معلوم) مش بتتحول لنهائية أبداً.
 *
 * @param observation المشاهدة المقروءة بعد المطالبة
 * @returns تسوية الطلب، وهي اللي بتحدد يتشال من الجولة ولا يدخل خريطة الإعادة
 */
export function settleClaim(observation: ClaimObservation): ClaimSettlement {
  switch (observation.kind) {
    case 'ABSENT':
      return 'ABSENT';
    case 'FUTURE_UNATTEMPTED':
      return 'FUTURE_UNATTEMPTED';
    case 'UNKNOWN':
      return 'RETRY';
    case 'STATUS':
      return observation.status === 'SCHEDULED' ? 'RETRY' : 'TERMINAL';
  }
}

/** الطلب اللي بيتقاس عليه الاستحقاق: حالته وموعد استحقاقه. */
export interface ClaimableRequest {
  /** حالة الطلب المقروءة في المعاملة. */
  readonly status: RatingRequestStatus;
  /** موعد استحقاق المطالبة للطلب ده. */
  readonly dueAt: Date;
}

/**
 * هل الطلب قابل للمطالبة في اللحظة دي؟
 *
 * القاعدة: الطلب لازم يكون مجدولاً ومستحقاً. الطلب المستقبلي ما بيتلمسش في
 * الجولة الحالية، والطلب في حالة تانية خلاص اتعالج قبل كده.
 *
 * @param request الطلب المقروء بحالته وموعد استحقاقه
 * @param now لحظة القرار المحقونة
 * @returns true لو الطلب مجدول ومستحق في اللحظة دي
 */
export function isClaimable(request: ClaimableRequest, now: Date): boolean {
  return request.status === 'SCHEDULED' && request.dueAt.getTime() <= now.getTime();
}

/**
 * بيحوّل الحالة المقروءة بعد المطالبة إلى مشاهدة.
 *
 * إعادة القراءة جوه نفس معاملة المطالبة، فالحالة المقروءة هي اللي بتحدد هل
 * الطلب خلص ولا لسه محتاج إعادة محاولة.
 *
 * @param status الحالة المقروءة بعد المطالبة
 * @returns مشاهدة تسوية الطلب
 */
export function rereadObservation(status: RatingRequestStatus): ClaimObservation {
  return { kind: 'STATUS', status };
}

/**
 * أقدم لحظة استحقاق في خريطة الإعادة، أو null لما الخريطة فاضية.
 *
 * الدالة بتاخد الشكل بس، مش نوع المنفذ، عشان طبقة الـ domain ما تعرفش حاجة عن
 * ports؛ وعمرها ما بتحسب وقت، هي بتختار الأقدم من اللي اتقرا.
 *
 * @param retries خريطة الإعادة، مفتاحها معرّف الطلب
 * @returns أقدم لحظة استحقاق بالمللي ثانية، أو null لما الخريطة فاضية
 */
export function oldestEligibleAt(
  retries: Readonly<Record<string, { readonly eligibleAt: number }>>,
): number | null {
  let oldest: number | null = null;
  for (const retry of Object.values(retries)) {
    if (oldest === null || retry.eligibleAt < oldest) oldest = retry.eligibleAt;
  }
  return oldest;
}

/** سبب انتهاء الدور: بيقول للمشغّل ليه الدور وقف. */
export type RatingClaimsEndReason =
  /** مالك تاني شغّال على نفس الشركة، فالدور وقّف من غير ما يمس حاجة. */
  | 'ACQUIRE_BUSY'
  /** حالة الشركة في Redis مش صالحة، والدور ما بيعيدش تهيئة. */
  | 'STATE_CORRUPT'
  /** السور اتغيّر في نص الدور: مالك تاني أخد الحالة، أو النسخة اتغيّرت. */
  | 'FENCE_LOST'
  /** سقف ملكية الدور اتقضى، فمفيش صف جديد بيبدأ. */
  | 'LIMIT_REACHED'
  /** الدور خلص شغله عادي. */
  | 'COMPLETED';

/**
 * ملخص الدور: أعداد التسويات وزيارات المسارين وسبب الانتهاء.
 *
 * الملخص مالوش أي معرّف: مفيش طلب ولا جولة ولا مفتاح، عشان يتكتب في السجل
 * من غير ما يسرّب بيانات المستأجر.
 */
export interface RatingClaimsTurnSummary {
  /** عدد التسويات لكل مصير. */
  readonly settlements: Readonly<Record<ClaimSettlement, number>>;
  /** عدد الصفوف الأمامية اللي الدور زارها. */
  readonly forwardVisits: number;
  /** عدد الصفوف اللي اتخدّمت من خريطة الإعادة. */
  readonly retryVisits: number;
  /** سبب انتهاء الدور. */
  readonly end: RatingClaimsEndReason;
}
