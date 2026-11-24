import { employmentOverlapsMonth, type EmploymentDates } from './employment-overlap.ts';

const FULL_SHARE = 10000n;

/** رصيد سالب يترحّل عند الاعتماد: نوعه ومبلغه كما سيُخزَّن (سالب، بمقياس الفلس) (D-22). */
export interface PlannedCarry {
  readonly employeeId: string;
  readonly kind: 'COMMISSION' | 'TIP_CARD';
  readonly amount: bigint;
}

/** سطر بند للتحقق من اكتمال حصص مؤدياته (D-14): معرّف البند وحالته وحصة هذه المؤدية بنقاط الأساس. */
export interface ShareCheckLine {
  readonly lineId: string;
  readonly status: 'ACTIVE' | 'CANCELLED';
  readonly shareBps: bigint;
}

/** رصيد موظفة عند نهاية الكشف بمقياس الفلس: ما يرحَّل من جانب العمولة ومن جانب بقشيش الكارت، موجبًا أو سالبًا (§9). */
export interface EmployeeCarryBalance {
  readonly employeeId: string;
  readonly commissionCarryOut: bigint;
  readonly tipCarryOut: bigint;
}

/**
 * يحدد الأرصدة السالبة التي يكتبها اعتماد الكشف كمرحّلات (D-22): رصيد العمولة السالب يصير مرحّل `COMMISSION` ورصيد
 * بقشيش الكارت السالب مرحّل `TIP_CARD`، ولا يتقاصّ النوعان (BR-06). **الموظفة التي لا يتقاطع عملها مع شهر الاعتماد لا
 * يُرحَّل رصيدها مرة ثانية** (CS-Q8، CS-Q28): رصيدها يبقى سالبًا في الكشف ويسويه المالك خارج النظام. الترتيب ثابت (الموظفة
 * ثم النوع) كي تكون الكتابة حتمية. حساب الأرصدة نفسها من الصفوف المجمّدة يتم بدالة المستحق في محرك العمولات قبل هذه الدالة.
 *
 * @param period شهر الكشف المعتمَد بصيغة YYYY-MM
 * @param balances أرصدة الموظفات عند نهاية الكشف (لكل موظفة لها صفوف)
 * @param employment تواريخ عمل كل موظفة في الكشف؛ غيابها خطأ برمجي لأن كل صاحبة رصيد لها سجل موظفين
 * @returns المرحّلات الواجب كتابتها، قائمة فارغة لو لا رصيد سالب
 * @throws Error لو غابت تواريخ عمل موظفة ذات رصيد سالب
 */
export function planApprovalCarries(
  period: string,
  balances: readonly EmployeeCarryBalance[],
  employment: ReadonlyMap<string, EmploymentDates>,
): PlannedCarry[] {
  const carries: PlannedCarry[] = [];
  const ordered = [...balances].sort((a, b) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0));
  for (const balance of ordered) {
    const { employeeId } = balance;
    if (balance.commissionCarryOut >= 0n && balance.tipCarryOut >= 0n) continue;
    const dates = employment.get(employeeId);
    if (dates === undefined) {
      throw new Error(`Employment dates are missing for employee ${employeeId}`);
    }
    if (!employmentOverlapsMonth(dates, period)) continue;
    if (balance.commissionCarryOut < 0n) {
      carries.push({ employeeId, kind: 'COMMISSION', amount: balance.commissionCarryOut });
    }
    if (balance.tipCarryOut < 0n) {
      carries.push({ employeeId, kind: 'TIP_CARD', amount: balance.tipCarryOut });
    }
  }
  return carries;
}

/**
 * يرجّع معرّفات البنود النشطة التي لا يساوي مجموع حصص مؤدياتها 10000 نقطة أساس (D-14). القيد المؤجَّل في
 * قاعدة البيانات يمنعها عند التسجيل، وهذا فحص دفاعي على ما يقرؤه الاعتماد. البند الملغى لا يدخل الفحص.
 *
 * @param lines صفوف البنود المقروءة، صف لكل مؤدية
 * @returns معرّفات البنود الناقصة أو الزائدة، مرتبة؛ فارغة لو كلها كاملة
 */
export function incompleteLineShares(lines: readonly ShareCheckLine[]): string[] {
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    if (line.status !== 'ACTIVE') continue;
    totals.set(line.lineId, (totals.get(line.lineId) ?? 0n) + line.shareBps);
  }
  return [...totals.entries()]
    .filter(([, total]) => total !== FULL_SHARE)
    .map(([lineId]) => lineId)
    .sort();
}

/**
 * هل في مشكلة تمنع الاعتماد؟ أي مشكلة تسعير (`NO_PLAN`، `NO_SALARY`) أو تصحيح موقوف مفتوح تُجمع من موظفات
 * الكشف تمنع المراجعة والاعتماد معًا (FR-027).
 *
 * @param employees موظفات الكشف بمشاكلهن، من نفس الإسقاط الذي يعرضه الكشف
 * @returns المشاكل بموظفتها، فارغة لو لا مانع
 */
export function approvalBlockingIssues<Code extends string>(
  employees: readonly {
    readonly employeeId: string;
    readonly issues: readonly { readonly code: Code }[];
  }[],
): { readonly employeeId: string; readonly code: Code }[] {
  return employees.flatMap((employee) =>
    employee.issues.map((issue) => ({ employeeId: employee.employeeId, code: issue.code })),
  );
}
