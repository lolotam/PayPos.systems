import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';

/** صف جرس تقييم منخفض بأحد المفتاحين؛ معاملاته معامل واحد من نوع details بشكل ثابت. */
export type LowRatingItem = Extract<
  InAppNotification,
  { template_key: 'low_rating' | 'low_rating_with_comment' }
>;

/** كل الصفوف ما عدا جرسَي التقييم المنخفض: معاملاتها نصوص بسيطة. */
export type ScalarNotification = Exclude<InAppNotification, LowRatingItem>;

/** هل الصف واحد من جرسَي التقييم المنخفض (المراجعة 1 فقط؛ الأحدث بيتخطاه القارئ قبل ما يوصل هنا). */
export function isLowRatingNotice(item: InAppNotification): item is LowRatingItem {
  return item.template_key === 'low_rating' || item.template_key === 'low_rating_with_comment';
}

// عزل ثنائي الاتجاه عشان اسم عربي جوه جملة إنجليزية (أو العكس) والأرقام ما يلخبطوش ترتيب الجملة.
const isolate = (text: string): string => `\u2068${text}\u2069`;

// الاسم الناقص بلغة العارض: العربي الغائب يرجع للإنجليزي، والإنجليزي الغائب يبقى التسمية العامة.
function pickName(locale: Locale, ar: string | null, en: string | null, generic: string): string {
  return locale === 'ar' ? (ar ?? en ?? generic) : (en ?? generic);
}

/**
 * نص جرس التقييم المنخفض بلغة العارض: النجوم والفرع والتاريخ وكل المنفّذين وعميل التقييم وآخر أرقام هاتفه.
 * التعليق مش جزء من النص؛ بيتعرض لوحده من lowRatingComment كنص عادي.
 *
 * @param item صف الجرس بأحد المفتاحين
 * @param locale لغة الواجهة
 * @returns جملة واحدة جاهزة للعرض كنص
 */
export function renderLowRatingNotice(item: LowRatingItem, locale: Locale): string {
  const details = item.safe_parameters[0].value;
  const performers = details.performers.map((performer) =>
    isolate(
      pickName(locale, performer.name_ar, performer.name_en, t(locale, 'inApp.generic_employee')),
    ),
  );
  const values: Record<string, string> = {
    stars: t(locale, details.stars === 1 ? 'inApp.low_rating_stars_1' : 'inApp.low_rating_stars_2'),
    branch: isolate(
      pickName(
        locale,
        details.branch_name_ar,
        details.branch_name_en,
        t(locale, 'inApp.generic_branch'),
      ),
    ),
    business_date: details.business_date,
    performers: performers.join(t(locale, 'inApp.low_rating_names_separator')),
    customer: isolate(details.customer_name ?? t(locale, 'inApp.low_rating_generic_customer')),
    phone_last3: isolate(details.phone_last3),
  };
  return t(locale, 'inApp.low_rating_summary').replace(
    /\{\{([a-z_0-9]+)\}\}/g,
    (placeholder, name: string) => values[name] ?? placeholder,
  );
}

/** تعليق العميل لصف with_comment فقط؛ null لأي صف تاني. بيتعرض كنص (React بيهرّبه)، مش رابط ولا HTML. */
export function lowRatingComment(item: InAppNotification): string | null {
  return item.template_key === 'low_rating_with_comment'
    ? item.safe_parameters[0].value.comment
    : null;
}
