/**
 * بيطبّع اسم التصنيف/الخدمة كما هو عند واجهة الكتالوج: مسافات مطبّعة إلى مسافة واحدة ثم تشذيب.
 * التطبيع نفسه الذي يُخزَّن به الاسم وقت الإنشاء، فهو مرجع المفتاح الواحد عبر الحدود (A-9/A-11).
 *
 * @param name الاسم كما ورد قبل التطبيع
 * @returns الاسم بعد تفعيع المسافات والتشذيب
 */
export function normalizeServiceCategoryName(name: string): string {
  return name.replace(/\s+/gu, ' ').replace(/^\s+|\s+$/gu, '');
}

/**
 * بيحسب مفتاح اسم الخدمة/التصنيف: التطبيع ثم الحروف الصغيرة، بنفس معمِّر فهرس التصنيفات
 * العامل (`service_categories_business_name_uq` على الاسم المخزّن المطبَّع) مش بتعبير بيحاكيه.
 *
 * @param nameEn الاسم الإنجليزي بعد محققه
 * @returns مفتاح المطابقة داخل الملف وقاعدة البيانات
 */
export function serviceCategoryKey(nameEn: string): string {
  return normalizeServiceCategoryName(nameEn).toLowerCase();
}
