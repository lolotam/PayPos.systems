/** النطاق الفعّال للقارئ كما حلّته identity: النشاط كله أو فروع محددة (CS-Q20). */
export interface StatementExportReaderScope {
  readonly businessWide: boolean;
  readonly branchIds: readonly string[];
}

/** صف الموظفة المجمّد في الكشف: معرّفها وكل الفروع اللي كانت مربوطة بيها في الشهر. */
export interface FrozenEmployeeBranches {
  readonly employeeId: string;
  readonly attachedBranchIds: readonly string[];
}

/** النطاق المحفوظ مع طلب التصدير: BUSINESS بلا مصفوفات، أو BRANCHES بالفروع والموظفات المصرّح بيها. */
export type StatementExportScope =
  | { readonly kind: 'BUSINESS' }
  | {
      readonly kind: 'BRANCHES';
      readonly branchIds: readonly string[];
      readonly employeeIds: readonly string[];
    };

/**
 * يرجّع الموظفات اللي فروعهن المجمّدة بتتقاطع مع مجموعة فروع، بترتيب المعرّف.
 * القاعدة اليومية الواحدة (CS-Q23): الموظفة بتظهر لقارئ فرع لو أي فرع كانت مربوطة بيه في الشهر داخل نطاقه.
 *
 * @param employees صفوف `EMPLOYEE` المجمّدة في الكشف المعتمد
 * @param branchIds مجموعة الفروع اللي القارئ مسموح له بيها
 * @returns معرّفات الموظفات المرئيات، مرتبة تصاعدياً من غير تكرار
 */
export function employeesVisibleToBranches(
  employees: readonly FrozenEmployeeBranches[],
  branchIds: readonly string[],
): readonly string[] {
  const allowed = new Set(branchIds);
  const visible = employees
    .filter((employee) => employee.attachedBranchIds.some((branch) => allowed.has(branch)))
    .map((employee) => employee.employeeId);
  return [...new Set(visible)].sort();
}

/**
 * يحدد نطاق طلب التصدير وقت الطلب (FR-050): BUSINESS لقارئ على مستوى النشاط بلا DENY ساري بس،
 * وغير كده BRANCHES بمجموعة فروعه الفعّالة كلها (مش فرع واحد) وموظفاتها من صفوف الكشف المجمّدة
 * مش من الارتباط الحي اللي ممكن يتعدّل بعد الاعتماد. مجموعة الفروع اللي بتغطي كل فروع النشاط
 * لقارئ فروع بتفضل BRANCHES (CM-23g).
 *
 * @param reader النطاق الفعّال للقارئ
 * @param employees صفوف `EMPLOYEE` المجمّدة في الكشف
 * @returns النطاق اللي بيتخزّن مع الطلب
 */
export function planStatementExportScope(
  reader: StatementExportReaderScope,
  employees: readonly FrozenEmployeeBranches[],
): StatementExportScope {
  if (reader.businessWide) return { kind: 'BUSINESS' };
  const branchIds = [...reader.branchIds].sort();
  return {
    kind: 'BRANCHES',
    branchIds,
    employeeIds: employeesVisibleToBranches(employees, branchIds),
  };
}

/**
 * يتأكد وقت التحميل إن صلاحية الطالب الحالية لسه بتغطي النطاق المحفوظ (FR-050): النطاق المحفوظ سقف مش منحة.
 * طلب BUSINESS محتاج قارئ على مستوى النشاط لسه، وطلب BRANCHES محتاج فروعه المحفوظة كلها جوه مجموعة الفروع
 * الحالية وكل موظفة محفوظة لسه ظاهرة للمجموعة دي.
 *
 * @param saved النطاق المحفوظ مع الطلب
 * @param current النطاق الفعّال للقارئ دلوقتي
 * @param employees صفوف `EMPLOYEE` المجمّدة في الكشف
 * @returns true لو الصلاحية الحالية لسه بتغطي كل اللي اتحفظ
 */
export function statementExportStillCovered(
  saved: StatementExportScope,
  current: StatementExportReaderScope,
  employees: readonly FrozenEmployeeBranches[],
): boolean {
  if (saved.kind === 'BUSINESS') return current.businessWide;
  const currentBranches = new Set(current.branchIds);
  if (!saved.branchIds.every((branch) => currentBranches.has(branch))) return false;
  const visible = new Set(employeesVisibleToBranches(employees, current.branchIds));
  return saved.employeeIds.every((employee) => visible.has(employee));
}

/**
 * اسم ملف التصدير: ASCII بس عشان الهيدر يوصل نفس الاسم في كل المتصفحات.
 *
 * @param period الشهر بصيغة YYYY-MM
 * @returns اسم الملف
 */
export function statementExportFilename(period: string): string {
  return `commission-statement-${period}.xlsx`;
}
