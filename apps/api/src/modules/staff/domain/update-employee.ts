import { employeeNameMatchKey } from '@pospay/domain';
import {
  EmployeeCreationError,
  validateEmployeeCreation,
  validateEmployeeBranch,
  type EmployeeRecord,
  type EmployeeCreationContext,
} from './create-employee.ts';

/** سجل التعديل لا يحتوي على راتب أو صلاحيات، والفروع هنا ارتباطات حالية وليست عضويات دخول. */
export interface EditableEmployee extends EmployeeRecord {
  readonly revision: number;
  readonly branch_ids: readonly string[];
}
/** تواريخ الارتباط الأصلي تبقى مستقلة عن تصحيح تاريخ التعيين. */
export interface BranchAttachment {
  readonly id: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string | null;
}
/** الطلب يحمل النسخة التي قرأها المدير لمنع استبدال تعديل أحدث. */
export interface EmployeeUpdateTerms {
  readonly primary_branch_id: string;
  readonly name_en: string;
  readonly name_ar?: string | null | undefined;
  readonly role_code: EmployeeRecord['role_code'];
  readonly hire_date: string;
  readonly contract_end?: string | null | undefined;
  readonly user_id?: string | null | undefined;
  readonly branch_ids: readonly string[];
  readonly expected_revision: number;
  readonly branch_effective_date: string;
}
/** الفروق تكفي لإغلاق الصف القديم وإضافة صف جديد دون حذف التاريخ. */
export interface EmployeeUpdatePlan {
  readonly after: EditableEmployee;
  readonly name_en_key: string;
  readonly name_ar_key: string | null;
  readonly attach: readonly string[];
  readonly detach: readonly string[];
  readonly changed: boolean;
}

/**
 * يرفض الفروع الخارجية كالغياب أولاً؛ يبني حالة الموظف التالية مع الفرع الرئيسي والنسخة المحمية.
 *
 * @param before السجل المحفوظ قبل التعديل
 * @param terms بيانات المدير كاملة مع النسخة والتاريخ الصريح
 * @param history التاريخ الكامل للفروع، حتى لا يتقاطع ارتباط جديد مع فترة مغلقة
 * @param contexts تبعية كل فرع مطلوب داخل الشركة
 * @returns خطة للحفظ والتدقيق بمفاتيح مطابقة داخلية منفصلة عن بيانات العرض، أو رفض مسمى
 */
export function planEmployeeUpdate(
  before: EditableEmployee,
  terms: EmployeeUpdateTerms,
  history: readonly BranchAttachment[],
  contexts: readonly EmployeeCreationContext[],
): EmployeeUpdatePlan {
  for (const context of contexts) validateEmployeeBranch(before.business_id, context);
  if (terms.expected_revision !== before.revision)
    throw new EmployeeCreationError('EMPLOYEE_REVISION_CONFLICT');
  const branchIds = [...new Set(terms.branch_ids)].sort();
  if (!branchIds.includes(terms.primary_branch_id))
    throw new EmployeeCreationError('EMPLOYEE_PRIMARY_BRANCH_REQUIRED');
  const after = {
    ...before,
    primary_branch_id: terms.primary_branch_id,
    name_en: terms.name_en,
    name_ar: terms.name_ar ?? null,
    role_code: terms.role_code,
    hire_date: terms.hire_date,
    contract_end: terms.contract_end ?? null,
    user_id: terms.user_id ?? null,
    branch_ids: branchIds,
  };
  for (const context of contexts) validateEmployeeCreation(after, context);
  const active = history.filter((row) => row.to === null);
  const attach = branchIds.filter((branch) => !active.some((row) => row.branchId === branch));
  const removed = active.filter((row) => !branchIds.includes(row.branchId));
  if (removed.some((row) => terms.branch_effective_date <= row.from))
    throw new EmployeeCreationError('EMPLOYEE_BRANCH_DATE_BEFORE_START');
  // الفترة الجديدة بلا نهاية؛ كل فترة لنفس الفرع تنتهي بعد بدايتها تتقاطع معها، حتى لو كانت مغلقة.
  if (
    attach.some((branch) =>
      history.some(
        (row) =>
          row.branchId === branch && (row.to === null || terms.branch_effective_date < row.to),
      ),
    )
  )
    throw new EmployeeCreationError('EMPLOYEE_BRANCH_HISTORY_OVERLAP');
  // قرار المالك 2026-10-03: تاريخ الفروع ميلادي يدخله المدير؛ البداية شاملة والنهاية مستبعدة والتحركات المستقبلية مسموحة.
  // قرار المالك 2026-10-03: التصحيح لا يعيد كتابة الحضور أو التاريخ السابق ولا يغيّر جلسة مفتوحة؛ القواعد الجديدة من الدخول التالي.
  // PR 22 يطبق تفاصيل الحضور وفترات أهلية الفروع؛ هذا التعديل يحفظ البيانات والتدقيق فقط.
  const changed =
    JSON.stringify(after) !==
    JSON.stringify({ ...before, branch_ids: [...before.branch_ids].sort() });
  return {
    after: { ...after, revision: changed ? before.revision + 1 : before.revision },
    name_en_key: employeeNameMatchKey(after.name_en),
    name_ar_key: after.name_ar === null ? null : employeeNameMatchKey(after.name_ar),
    attach,
    detach: removed.map((row) => row.id),
    changed,
  };
}
