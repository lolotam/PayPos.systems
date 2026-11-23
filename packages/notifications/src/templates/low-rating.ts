import { storedCommentAllowed } from './rating-comment-rule.ts';

/** المعامل الوحيد لجرس التقييم المنخفض: كائن تفاصيل له شكل ثابت، مش SafeParameter نصي. */
export interface LowRatingDetailsParameter {
  readonly name: 'details';
  readonly type: 'details';
  readonly value: Readonly<Record<string, unknown>>;
}
/** تعريف قالب جرس التقييم المنخفض: نفس مفتاح ومراجعة ولغات القوالب الأخرى، ونسخة بالعربي والإنجليزي. */
export interface LowRatingTemplateDefinition {
  readonly key: 'low_rating' | 'low_rating_with_comment';
  readonly revision: 1;
  readonly locales: readonly ('ar' | 'en')[];
  readonly copy: Readonly<Record<'ar' | 'en', string>>;
}

/** جرس التقييم المنخفض لمن لا يقرأ التعليق (RT-23): النجوم والفرع واليوم والمنفّذون والعميل وآخر ٣ أرقام. */
export const lowRating: LowRatingTemplateDefinition = {
  key: 'low_rating',
  revision: 1,
  locales: ['ar', 'en'],
  copy: {
    ar: 'تقييم منخفض: {{stars}} في {{branch}} بتاريخ {{business_date}}. المنفّذون: {{performers}}. العميل: {{customer}}، الهاتف المنتهي بـ {{phone_last3}}.',
    en: 'Low rating: {{stars}} at {{branch}} on {{business_date}}. Performed by {{performers}}. Customer: {{customer}}, phone ending {{phone_last3}}.',
  },
};
/** نفس الجرس لقارئ التعليق (RT-Q9): التعليق كاملًا من غير حذف. */
export const lowRatingWithComment: LowRatingTemplateDefinition = {
  key: 'low_rating_with_comment',
  revision: 1,
  locales: ['ar', 'en'],
  copy: {
    ar: `${lowRating.copy.ar} تعليق العميل: {{comment}}`,
    en: `${lowRating.copy.en} Customer comment: {{comment}}`,
  },
};

// نفس فلتر اسم العرض في definition.ts، والطول بالـ code points زي عقد low-rating-notifications.ts.
const DISPLAY_NAME_UNSAFE =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;
const BASE_KEYS = [
  'stars',
  'branch_name_ar',
  'branch_name_en',
  'business_date',
  'performers',
  'customer_name',
  'phone_last3',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function nullableName(value: unknown, maxCodePoints: number): boolean {
  if (value === null) return true;
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxCodePoints * 2 &&
    value === value.trim() &&
    Array.from(value).length <= maxCodePoints &&
    !DISPLAY_NAME_UNSAFE.test(value)
  );
}

function isoDate(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function validPerformer(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['name_ar', 'name_en']) &&
    nullableName(value['name_ar'], 255) &&
    nullableName(value['name_en'], 255)
  );
}

function validDetails(value: unknown, withComment: boolean): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, withComment ? [...BASE_KEYS, 'comment'] : BASE_KEYS)) return false;
  const { performers, phone_last3: last3 } = value;
  return (
    (value['stars'] === 1 || value['stars'] === 2) &&
    nullableName(value['branch_name_ar'], 255) &&
    nullableName(value['branch_name_en'], 255) &&
    isoDate(value['business_date']) &&
    Array.isArray(performers) &&
    performers.every(validPerformer) &&
    nullableName(value['customer_name'], 200) &&
    typeof last3 === 'string' &&
    /^[0-9]{2,3}$/.test(last3) &&
    (!withComment || storedCommentAllowed(value['comment']))
  );
}

/**
 * بيتأكد إن جرس التقييم المنخفض معروف بمفتاحه ومراجعته ولغته، وإن معامله الوحيد تفاصيل بالشكل الصارم بالظبط.
 * التعليق إجباري في low_rating_with_comment وممنوع في low_rating، وأي مفتاح زيادة في أي مستوى مرفوض.
 *
 * @param key مفتاح القالب
 * @param revision مراجعة القالب
 * @param locale لغة الصف المخزن
 * @param parameters المعاملات كما وصلت في الطلب
 * @returns true لو القالب واحد من الاتنين والمعاملات مطابقة لعقد low-rating-notifications.ts
 */
export function validLowRatingTemplate(
  key: string,
  revision: number,
  locale: string,
  parameters: unknown,
): boolean {
  const definition = [lowRating, lowRatingWithComment].find((item) => item.key === key);
  if (definition === undefined || revision !== definition.revision) return false;
  if (!definition.locales.some((item) => item === locale)) return false;
  if (!Array.isArray(parameters) || parameters.length !== 1) return false;
  const parameter: unknown = parameters[0];
  return (
    isRecord(parameter) &&
    hasExactKeys(parameter, ['name', 'type', 'value']) &&
    parameter['name'] === 'details' &&
    parameter['type'] === 'details' &&
    validDetails(parameter['value'], definition.key === 'low_rating_with_comment')
  );
}
