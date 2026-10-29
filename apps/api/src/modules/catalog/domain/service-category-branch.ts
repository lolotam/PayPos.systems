import { ServiceCategoryError } from './errors.ts';
import type { ServiceCategoryRecord, ServiceCategoryView } from './service-category.ts';

/** حالة تصنيف داخل فرع: مفعّل صراحة أو مخفي محلياً. */
export type ServiceCategoryBranchState = 'ENABLED' | 'HIDDEN';

/** صف إعداد التصنيف في فرع، بنسخة مستقلة عن نسخة التصنيف نفسه. */
export interface ServiceCategoryBranchSettingRecord {
  readonly id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly category_id: string;
  readonly state: ServiceCategoryBranchState;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** التصنيف مع إعداد الفرع كما تعرضه قائمة الفرع ونتيجة الكتابة. */
export interface ServiceCategoryBranchView extends ServiceCategoryView {
  readonly setting_state: ServiceCategoryBranchState | null;
  readonly setting_revision: number | null;
}

/** مدخلات الانتقال بعد حل النشاط والفرع والتصنيف داخل المعاملة. */
export interface ServiceCategoryBranchStatePlanInput {
  readonly id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly category_id: string;
  readonly state: ServiceCategoryBranchState;
  readonly expected_revision: number | null;
}

/**
 * يقرر هل التصنيف مستخدم في فرع: المغلق غير مستخدم، وHIDDEN يغلب الملكية والتفعيل،
 * والمشترك متاح للكل، والخاص لمالكه أو لمن فعّله. الإخفاء لا يغيّر بيع أي خدمة.
 *
 * @param category سجل التصنيف المقروء
 * @param branchId الفرع الذي تُحسب له القاعدة
 * @param settingState حالة إعداد الفرع أو غيابها
 * @returns هل يظهر التصنيف ضمن in_use لهذا الفرع
 */
export function isServiceCategoryInUse(
  category: Pick<ServiceCategoryRecord, 'closed_at' | 'visibility' | 'owner_branch_id'>,
  branchId: string,
  settingState: ServiceCategoryBranchState | null,
): boolean {
  if (category.closed_at !== null || settingState === 'HIDDEN') return false;
  return (
    category.visibility === 'BUSINESS' ||
    category.owner_branch_id === branchId ||
    settingState === 'ENABLED'
  );
}

/**
 * يبني حالة الفرع التالية مع حماية الكتابة المتفائلة: أول كتابة تتطلب expected_revision=null
 * وتبدأ عند ١، وكل كتابة لاحقة تطابق النسخة الحالية ثم تزيدها ١. أي اختلاف رفض قديم.
 *
 * @param current صف الإعداد المقفول أو غيابه
 * @param input الحالة الجديدة والنسخة المتوقعة وهويات الصف
 * @param at وقت الكتابة المحقون
 * @returns سجل الإعداد الذي يجب إدخاله أو تحديثه
 * @throws ServiceCategoryError باسم SERVICE_CATEGORY_REVISION_CONFLICT عند نسخة قديمة
 */
export function planServiceCategoryBranchState(
  current: ServiceCategoryBranchSettingRecord | null,
  input: ServiceCategoryBranchStatePlanInput,
  at: Date,
): ServiceCategoryBranchSettingRecord {
  if (
    (current === null && input.expected_revision !== null) ||
    (current !== null && input.expected_revision !== current.revision)
  )
    throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
  const timestamp = at.toISOString();
  return {
    id: input.id,
    business_id: input.business_id,
    branch_id: input.branch_id,
    category_id: input.category_id,
    state: input.state,
    revision: current === null ? 1 : current.revision + 1,
    created_at: current?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

/**
 * يعرض التصنيف وإعداد الفرع معاً؛ غياب صف الإعداد يظهر null في الحقلين ولا يُختلق كتفعيل.
 *
 * @param category سجل التصنيف
 * @param setting إعداد الفرع المحفوظ أو غيابه
 * @returns بند قائمة الفرع وشكل نتيجة تغيير الحالة
 */
export function serviceCategoryBranchView(
  category: ServiceCategoryRecord,
  setting: ServiceCategoryBranchSettingRecord | null,
): ServiceCategoryBranchView {
  return {
    id: category.id,
    name_en: category.name_en,
    name_ar: category.name_ar,
    visibility: category.visibility,
    owner_branch_id: category.owner_branch_id,
    closed_at: category.closed_at,
    revision: category.revision,
    setting_state: setting?.state ?? null,
    setting_revision: setting?.revision ?? null,
  };
}

/**
 * يلتقط إعداد الفرع كاملاً للتدقيق، بلا بيانات خدمة أو عميل وبلا تغيير لقيمه.
 *
 * @param record سجل إعداد الفرع
 * @returns نسخة JSON من السجل
 */
export function serviceCategoryBranchSettingSnapshot(
  record: ServiceCategoryBranchSettingRecord,
) {
  return { ...record };
}
