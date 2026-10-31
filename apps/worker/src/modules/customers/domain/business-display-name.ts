/** اسما النشاط كما يقراهم موديول tenancy: العربي اختياري والإنجليزي موجود. */
export interface BusinessDisplayNames {
  /** الاسم العربي، أو null لما مش محفوظ. */
  readonly name_ar: string | null;
  /** الاسم الإنجليزي — دايماً موجود. */
  readonly name_en: string;
}

/**
 * يختار اسم النشاط بلغة العميل: العربي لو العميل عربي والاسم العربي صالح للعرض، وإلا الإنجليزي.
 * الاسم العربي الفاضي أو اللي فيه مسافات بس مش صالح، فينزل للإنجليزي زي ما لو مش محفوظ.
 * الاسم اللي بيتختار بيرجع زي ما هو من غير قصّ؛ القصّ على حدّ معامل الإشعار شغل تاني.
 * العميل الإنجليزي بياخد الاسم الإنجليزي دايماً حتى لو فيه اسم عربي محفوظ.
 *
 * @param names اسما النشاط: العربي (اختياري) والإنجليزي
 * @param locale لغة العميل
 * @returns اسم النشاط بلغة العميل، بالرجوع للإنجليزي لما الاسم العربي مش موجود أو فاضي
 */
export function businessDisplayName(names: BusinessDisplayNames, locale: 'ar' | 'en'): string {
  if (locale !== 'ar') return names.name_en;
  const arabic = names.name_ar;
  return arabic === null || arabic.trim().length === 0 ? names.name_en : arabic;
}
