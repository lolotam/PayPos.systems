/** اسما النشاط كما يقراهم موديول tenancy: العربي اختياري والإنجليزي موجود. */
export interface BusinessDisplayNames {
  /** الاسم العربي، أو null لما مش محفوظ. */
  readonly name_ar: string | null;
  /** الاسم الإنجليزي — دايماً موجود. */
  readonly name_en: string;
}

/**
 * يختار اسم النشاط بلغة العميل: العربي لو العميل عربي والاسم العربي محفوظ، وإلا الإنجليزي.
 * العميل الإنجليزي بياخد الاسم الإنجليزي دايماً حتى لو فيه اسم عربي محفوظ.
 * القصّ على حدّ معامل الإشعار شغل تاني (القاعدة دي بتختار الاسم بس).
 *
 * @param names اسما النشاط: العربي (اختياري) والإنجليزي
 * @param locale لغة العميل
 * @returns اسم النشاط بلغة العميل، بالرجوع للإنجليزي لما الاسم العربي مش محفوظ
 */
export function businessDisplayName(names: BusinessDisplayNames, locale: 'ar' | 'en'): string {
  return locale === 'ar' ? (names.name_ar ?? names.name_en) : names.name_en;
}
