import { ServiceCategoryError } from './errors.ts';

/** مستوى ظهور التصنيف: مشترك بين فروع النشاط كلها، أو خاص بفرع الإنشاء. */
export type ServiceCategoryVisibility = 'BUSINESS' | 'BRANCH';

/** الاسمان كما يتوقعهما العقد، قبل التطبيع. */
export interface ServiceCategoryNames {
  readonly name_en: string;
  readonly name_ar: string;
}

/** سجل التصنيف كما يُحفظ ويُقرأ؛ النسخة ترتفع مع كل تغيير. */
export interface ServiceCategoryRecord {
  readonly id: string;
  readonly business_id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly owner_branch_id: string | null;
  readonly visibility: ServiceCategoryVisibility;
  readonly closed_at: string | null;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** التصنيف على السلك: ما تراه الشاشة والقائمة. */
export interface ServiceCategoryView {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly visibility: ServiceCategoryVisibility;
  readonly owner_branch_id: string | null;
  readonly closed_at: string | null;
  readonly revision: number;
}

/** نطاق التعديل: على مستوى النشاط، أو على مستوى فرع يملك التصنيف. */
export type ServiceCategoryScope = 'BUSINESS' | 'BRANCH';

/** طلب التعديل كما وصل من الشاشة بعد التحقق من العقد. */
export interface ServiceCategoryRenameRequest {
  readonly names: ServiceCategoryNames;
  readonly visibility?: ServiceCategoryVisibility;
  readonly expected_revision: number;
  readonly scope: ServiceCategoryScope;
  readonly branch_id: string | null;
}

/** خطة التعديل: السجل التالي وهل تغيّر شيء يستحق الحفظ والتدقيق. */
export interface ServiceCategoryRenamePlan {
  readonly after: ServiceCategoryRecord;
  readonly changed: boolean;
}

/**
 * يوحّد الاسم بالشكل الذي يشترطه القيد في قاعدة البيانات: تُشال المسافات البادئة والمؤخرة، وكل
 * تتابع مسافات يصير مسافة واحدة. الاختلاف بين التطبيع هنا والتطبيع هناك يجعل الكتابة مرفوضة.
 *
 * @param name الاسم كما جاء من العميل
 * @returns الاسم المطبّع
 */
export function normalizeServiceCategoryName(name: string): string {
  return name
    .replace(/[ \t\n\v\f\r]+/g, ' ')
    .replace(/^ +/, '')
    .replace(/ +$/, '');
}

/**
 * مفتاح التصنيف على مستوى النشاط: الاسم الإنجليزي المخزّن مطبّعاً ثم بحروف صغيرة. هو نفسه
 * الفهرس الفريد `service_categories_business_name_uq`، فالتطبيع وحالة الحروف يقرّران التشابه.
 *
 * @param nameEn الاسم الإنجليزي
 * @returns المفتاح على مستوى النشاط
 */
export function serviceCategoryKey(nameEn: string): string {
  return normalizeServiceCategoryName(nameEn).toLowerCase();
}

/**
 * يتحقق من الاسمين ويطبّعهما: الاسمان مطلوبان معاً (قرار المالك SI-Q13)، وكل واحد من ١ إلى ١٠٠
 * حرف بعد التشذيب، وبلا محرف تحكم.
 *
 * @param names الاسمان كما جاءا من العميل
 * @returns الاسمان المطبّعان
 * @throws ServiceCategoryError باسم SERVICE_CATEGORY_NAME_INVALID عند أي مخالفة
 */
export function validateServiceCategoryNames(names: ServiceCategoryNames): ServiceCategoryNames {
  for (const name of [names.name_en, names.name_ar]) {
    if (typeof name !== 'string') throw new ServiceCategoryError('SERVICE_CATEGORY_NAME_INVALID');
    const normalized = normalizeServiceCategoryName(name);
    if (normalized.length < 1 || normalized.length > 100)
      throw new ServiceCategoryError('SERVICE_CATEGORY_NAME_INVALID');
    if (/\p{Cc}/u.test(normalized)) throw new ServiceCategoryError('SERVICE_CATEGORY_NAME_INVALID');
  }
  return {
    name_en: normalizeServiceCategoryName(names.name_en),
    name_ar: normalizeServiceCategoryName(names.name_ar),
  };
}

/**
 * يبني تصنيفاً على مستوى النشاط: بلا فرع مالك، ومشارك مع كل الفروع، ونسخته الأولى ١.
 *
 * @param names الاسمان المتحققان
 * @param id معرف التصنيف المحقون
 * @param businessId النشاط المالك
 * @param at وقت الإنشاء المحقون
 * @returns سجل النسخة الأولى
 */
export function newBusinessServiceCategory(
  names: ServiceCategoryNames,
  id: string,
  businessId: string,
  at: Date,
): ServiceCategoryRecord {
  return {
    id,
    business_id: businessId,
    name_en: names.name_en,
    name_ar: names.name_ar,
    owner_branch_id: null,
    visibility: 'BUSINESS',
    closed_at: null,
    revision: 1,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
  };
}

/**
 * يبني تصنيفاً من فرع: الفرع يسجله مالكاً دائماً، والمشاركة اختيارية (BUSINESS لكل الفروع،
 * وBRANCH للفرع وحده).
 *
 * @param names الاسمان المتحققان
 * @param id معرف التصنيف المحقون
 * @param businessId النشاط المالك
 * @param branchId فرع الإنشاء الذي يسجله التصنيف
 * @param visibility المشاركة المختارة: BUSINESS أو BRANCH
 * @param at وقت الإنشاء المحقون
 * @returns سجل النسخة الأولى
 */
export function newBranchServiceCategory(
  names: ServiceCategoryNames,
  id: string,
  businessId: string,
  branchId: string,
  visibility: ServiceCategoryVisibility,
  at: Date,
): ServiceCategoryRecord {
  return {
    id,
    business_id: businessId,
    name_en: names.name_en,
    name_ar: names.name_ar,
    owner_branch_id: branchId,
    visibility,
    closed_at: null,
    revision: 1,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
  };
}

/**
 * يقرر تعديل التصنيف: المشاركة في اتجاه واحد (خاص يصير مشتركاً، والمشترك لا يعود خاصاً)،
 * والفرع يعدّل تصنيفاته الخاصة به وحدها، وكل تغيير يرفع النسخة.
 * حدود النطاق تُفحص قبل النسخة: رفض «مش مسموح» على النطاق يسبق رفض النسخة الزايدة.
 *
 * @param current السجل المقفول الحالي
 * @param request الطلب: الاسمان، والمشاركة المطلوبة، والنسخة المتوقعة، والنطاق
 * @param at وقت التعديل المحقون
 * @returns السجل التالي وهل تغيّر شيء يستحق الحفظ والتدقيق
 * @throws ServiceCategoryError برفض «مش مسموح» على النطاق أو المشاركة (SI-Q25)، أو بنسخة قديمة
 */
export function planServiceCategoryRename(
  current: ServiceCategoryRecord,
  request: ServiceCategoryRenameRequest,
  at: Date,
): ServiceCategoryRenamePlan {
  if (request.scope === 'BRANCH') {
    // التصنيف المشترك يُعدَّل من مستوى النشاط أيّاً كان صاحبه.
    if (current.visibility === 'BUSINESS')
      throw new ServiceCategoryError('SERVICE_CATEGORY_VISIBILITY_FIXED');
    // التصنيف الخاص بفرع آخر: رفض «مش مسموح» زي رفض تصنيف مشترك (SI-Q25)،
    // وهو ظاهر للفرع في قائمة المتاح تفعيله فردّه مش بيكشف حاجة.
    if (current.owner_branch_id !== request.branch_id)
      throw new ServiceCategoryError('SERVICE_CATEGORY_VISIBILITY_FIXED');
  }
  // فحص النسخة بعد حدود النطاق: رفض «مش مسموح» على النطاق يسبق رفض النسخة الزايدة.
  if (request.expected_revision !== current.revision)
    throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
  const visibility = request.visibility ?? current.visibility;
  if (current.visibility === 'BUSINESS' && visibility === 'BRANCH')
    throw new ServiceCategoryError('SERVICE_CATEGORY_VISIBILITY_FIXED');
  const names = validateServiceCategoryNames(request.names);
  const changed =
    current.name_en !== names.name_en ||
    current.name_ar !== names.name_ar ||
    current.visibility !== visibility;
  return {
    changed,
    after: changed
      ? {
          ...current,
          name_en: names.name_en,
          name_ar: names.name_ar,
          visibility,
          revision: current.revision + 1,
          updated_at: at.toISOString(),
        }
      : current,
  };
}

/**
 * إسقاط التصنيف في الشكل الذي تراه الشاشة والقائمة.
 *
 * @param record السجل المحفوظ
 * @returns التصنيف على السلك
 */
export function serviceCategoryView(record: ServiceCategoryRecord): ServiceCategoryView {
  return {
    id: record.id,
    name_en: record.name_en,
    name_ar: record.name_ar,
    visibility: record.visibility,
    owner_branch_id: record.owner_branch_id,
    closed_at: record.closed_at,
    revision: record.revision,
  };
}

/**
 * نسخة التدقيق: التصنيف كاملاً، بلا أي بيانات عميل أو خدمة.
 *
 * @param record السجل المحفوظ
 * @returns نسخة JSON للتدقيق
 */
export function serviceCategorySnapshot(record: ServiceCategoryRecord) {
  return { ...record };
}
