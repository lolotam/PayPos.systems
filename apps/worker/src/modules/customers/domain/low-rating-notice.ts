import type { AlertChannel, AlertRecipientRole, EffectiveAlertRule } from '@pospay/domain';
import { displaySafeName } from './display-name.ts';
import { phoneLast3 } from './phone-last3.ts';

/** أقصى عدد مستلمين في حدث واحد، وهو حد عقد الإشعار (ADR-0037 §5). */
const GROUP_SIZE = 100;

/** حقائق الحدث الموثوق التي يتحقق منها التقييم المحفوظ. */
export interface LowRatingFacts {
  readonly requestId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly stars: number;
}

/** التقييم المحفوظ كما يقرؤه المستهلك داخل المستأجر؛ نص التعليق لا يدخل الذاكرة هنا، وجوده فقط. */
export interface StoredRating extends LowRatingFacts {
  readonly hasComment: boolean;
  readonly businessDate: string;
  readonly customerId: string;
}

/** اسم منفذ بلغتي العرض؛ null لما لا اسم آمن في اللغة. */
export interface PerformerNames {
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

/** تفاصيل الجرس كما يفرضها عقد `lowRatingDetailsV1`، الأسماء الغايبة null والعارض يختار الاسم العام. */
export interface LowRatingDetails {
  readonly stars: 1 | 2;
  readonly branch_name_ar: string | null;
  readonly branch_name_en: string | null;
  readonly business_date: string;
  readonly performers: readonly { name_ar: string | null; name_en: string | null }[];
  readonly customer_name: string | null;
  readonly phone_last3: string;
}

/** مجموعة مستلمين بقالب واحد؛ التعليق يسافر مع مجموعة القراء فقط. */
export type NoticeGroup =
  | { readonly template: 'low_rating'; readonly userIds: readonly string[] }
  | {
      readonly template: 'low_rating_with_comment';
      readonly userIds: readonly string[];
      readonly comment: string;
    };

/** مستلم داخل التطبيق بالشكل الذي يقبله عقد `LowRatingReceived`. */
export interface LowRatingRecipient {
  readonly channel: 'IN_APP';
  readonly user_id: string;
  readonly locale: 'ar';
  readonly template_key: NoticeGroup['template'];
  readonly template_revision: 1;
  readonly safe_parameters: readonly [
    {
      readonly name: 'details';
      readonly type: 'details';
      readonly value: LowRatingDetails & { readonly comment?: string };
    },
  ];
}

/**
 * يقرر هل التقييم المحفوظ منخفض؛ نجمة أو نجمتان فقط (RT-22).
 *
 * @param stars عدد النجوم المحفوظ
 * @returns هل يستحق التقييم جرسًا
 */
export function isLowRating(stars: number): stars is 1 | 2 {
  return stars === 1 || stars === 2;
}

/**
 * يقارن الحدث الموثوق بالتقييم المحفوظ؛ أي اختلاف في الطلب أو النشاط أو الفرع أو النجوم حدث فاسد.
 *
 * @param event حقائق الحدث
 * @param stored التقييم المقروء داخل المستأجر
 * @returns هل تطابق الاثنان
 */
export function ratingMatchesEvent(event: LowRatingFacts, stored: LowRatingFacts): boolean {
  return (
    event.requestId === stored.requestId &&
    event.businessId === stored.businessId &&
    event.branchId === stored.branchId &&
    event.stars === stored.stars
  );
}

/**
 * يحدد من يستلم التنبيه ومن أي قناة من القاعدة الفعلية لحظة القرار: القاعدة المقفولة أو بلا أي قناة لا تُصدر شيئًا (BR-B5).
 * قاعدة إيميل أو واتساب وحدها فعّالة، فالأدوار ما بتتوقفش على وجود الجرس داخل التطبيق (AL-Q6).
 *
 * @param rule القاعدة الفعلية لنوع LOW_RATING بعد المفتاح العام
 * @returns أدوار المستلمين والقنوات وهل القاعدة فعّالة؛ فارغتان لما لا تنبيه
 */
export function lowRatingDelivery(
  rule: Pick<EffectiveAlertRule, 'enabled' | 'recipientRoles' | 'channels'>,
): { active: boolean; roles: readonly AlertRecipientRole[]; channels: readonly AlertChannel[] } {
  if (!rule.enabled || rule.channels.length === 0)
    return { active: false, roles: [], channels: [] };
  return { active: true, roles: rule.recipientRoles, channels: rule.channels };
}

/**
 * يرتب المستخدمين ويسقط التكرار، فعدد المستلمين المسجل في الدفتر ثابت مهما تكررت العضويات.
 *
 * @param userIds مستخدمو المديرين المؤهلون
 * @returns معرّفات مرتبة بلا تكرار
 */
export function sortedUnique(userIds: readonly string[]): readonly string[] {
  return [...new Set(userIds)].sort();
}

/**
 * التعليق كما كتبه العميل: يُعرض كما هو لقراء التعليق (RT-Q17). هذه الدالة هي المكان الوحيد
 * الذي يتغير فيه الجواب لو اختار أبو سالم غير ذلك؛ الفارغ يعامل كأنه بلا تعليق.
 *
 * @param stored التعليق المحفوظ أو null
 * @returns نص التعليق للإرسال، أو null لما لا تعليق
 */
export function noticeComment(stored: string | null): string | null {
  return stored === null || stored.length === 0 ? null : stored;
}

/**
 * يوزع المستلمين على قالبين منفصلين ثم يقطعهم لمجموعات لا تتجاوز مئة، ولا يختلط القالبان في مجموعة:
 * القراء (مجموعة جزئية من المرشحين) يأخذون القالب بالتعليق، والباقون القالب بلا تعليق؛ وبلا تعليق الكل بلا تعليق.
 *
 * @param users المرشحون مرتبين بلا تكرار
 * @param readers من يحق لهم قراءة التعليق؛ يُتجاهلون لو لا تعليق
 * @param comment التعليق بعد `noticeComment` أو null
 * @returns مجموعات القالب بالتعليق أولًا ثم القالب بلا تعليق
 */
export function recipientGroups(
  users: readonly string[],
  readers: readonly string[],
  comment: string | null,
): readonly NoticeGroup[] {
  const allowed = new Set(comment === null ? [] : readers);
  const plain = users.filter((user) => !allowed.has(user));
  if (comment === null) return chunks(plain).map(plainGroup);
  return [
    ...chunks(users.filter((user) => allowed.has(user))).map((userIds) => ({
      template: 'low_rating_with_comment' as const,
      userIds,
      comment,
    })),
    ...chunks(plain).map(plainGroup),
  ];
}

function plainGroup(userIds: readonly string[]): NoticeGroup {
  return { template: 'low_rating', userIds };
}

function chunks(userIds: readonly string[]): (readonly string[])[] {
  const groups: (readonly string[])[] = [];
  for (let i = 0; i < userIds.length; i += GROUP_SIZE)
    groups.push(userIds.slice(i, i + GROUP_SIZE));
  return groups;
}

/**
 * يجهز تفاصيل الجرس من المحفوظ: أسماء الفرع والعميل بحد الـ code point والاسم غير الآمن null،
 * والمنفذون بترتيب معرّف الموظف مع بقاء المكرر، وآخر ثلاثة أرقام من الهاتف فقط (RT-23).
 *
 * @param input نجوم التقييم وأسماء الفرع وتاريخ النشاط والمنفذون وبيانات العميل
 * @param input.stars نجوم التقييم
 * @param input.branch أسماء الفرع من التينانسي
 * @param input.branch.nameAr الاسم العربي للفرع أو null
 * @param input.branch.nameEn الاسم الإنجليزي للفرع أو null
 * @param input.businessDate تاريخ النشاط من طلب التقييم
 * @param input.performers أسماء المنفذين الأولى بترتيب معرّف الموظف
 * @param input.customer اسم العميل وهاتفه المخزّنان
 * @param input.customer.name اسم العميل كما هو مخزّن
 * @param input.customer.phone هاتف العميل بصيغة E.164
 * @returns التفاصيل بلا تعليق وبلا هاتف كامل
 */
export function lowRatingDetails(input: {
  stars: 1 | 2;
  branch: { nameAr: string | null; nameEn: string | null };
  businessDate: string;
  performers: readonly PerformerNames[];
  customer: { name: string; phone: string };
}): LowRatingDetails {
  return {
    stars: input.stars,
    branch_name_ar: displaySafeName(input.branch.nameAr, 255),
    branch_name_en: displaySafeName(input.branch.nameEn, 255),
    business_date: input.businessDate,
    performers: input.performers.map((p) => ({ name_ar: p.nameAr, name_en: p.nameEn })),
    customer_name: displaySafeName(input.customer.name, 200),
    phone_last3: phoneLast3(input.customer.phone),
  };
}

/**
 * يبني مستلمي المجموعة؛ مفتاح القالب يحدد شكل التفاصيل، فالتعليق لا يظهر إلا في مجموعة القراء.
 *
 * @param group مجموعة بقالب واحد
 * @param details تفاصيل الجرس المشتركة
 * @returns مستلمو IN_APP بلغة ar، لأن العارض يختار لغة المشاهد
 */
export function noticeRecipients(
  group: NoticeGroup,
  details: LowRatingDetails,
): readonly LowRatingRecipient[] {
  const value = group.template === 'low_rating' ? details : { ...details, comment: group.comment };
  return group.userIds.map((user_id) => ({
    channel: 'IN_APP' as const,
    user_id,
    locale: 'ar' as const,
    template_key: group.template,
    template_revision: 1 as const,
    safe_parameters: [{ name: 'details' as const, type: 'details' as const, value }] as const,
  }));
}
