/** لغة رأس البيان. */
export type StatementLanguage = 'ar' | 'en';

/**
 * الأسماء الرسمية ومعرف الشعار كما خُزّنوا. null يعني لسه ما اتكتبش.
 */
export interface StoredBusinessIdentity {
  readonly official_name_ar: string | null;
  readonly official_name_en: string | null;
  readonly logo_file_id: string | null;
}

/**
 * أسماء العرض من tenancy. الإنجليزي موجود دايمًا على النشاط.
 */
export interface BusinessDisplayNames {
  readonly name_ar: string | null;
  readonly name_en: string;
}

/** رأس البيان وهل للنشاط شعار مخزن. */
export interface StatementIdentity {
  readonly header_name: string;
  readonly has_logo: boolean;
}

function written(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * بيختار اسم رأس البيان وأول اسم موجود يكسب، وبيبلّغ هل فيه شعار مخزن.
 * الترتيب: الرسمي بلغة الطلب، ثم الرسمي باللغة التانية، ثم العرض بلغة الطلب، ثم العرض باللغة التانية.
 * الاسم الفاضي بعد القص مش اسم، عشان الرأس ما يطلعش فاضي، و`name_en` آخر ملجأ.
 * وجود الشعار هو وجود المعرف بس؛ صلاحية البايتات قرار قارئ البيان مش القرار ده.
 *
 * @param language لغة الرأس المطلوبة
 * @param identity الأسماء الرسمية ومعرف الشعار المخزنين
 * @param displayNames أسماء العرض من tenancy
 * @returns اسم الرأس وهل فيه شعار
 */
export function statementIdentity(
  language: StatementLanguage,
  identity: StoredBusinessIdentity,
  displayNames: BusinessDisplayNames,
): StatementIdentity {
  const requestedOfficial =
    language === 'ar' ? identity.official_name_ar : identity.official_name_en;
  const otherOfficial = language === 'ar' ? identity.official_name_en : identity.official_name_ar;
  const requestedDisplay = language === 'ar' ? displayNames.name_ar : displayNames.name_en;
  const otherDisplay = language === 'ar' ? displayNames.name_en : displayNames.name_ar;
  const header_name =
    written(requestedOfficial) ??
    written(otherOfficial) ??
    written(requestedDisplay) ??
    written(otherDisplay) ??
    displayNames.name_en;
  return { header_name, has_logo: identity.logo_file_id !== null };
}
