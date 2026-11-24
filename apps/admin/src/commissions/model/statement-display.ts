import type { CommissionStatementEmployee, CommissionStatementRow } from '@pospay/contracts';
import type { Locale, MessageKey } from '@pospay/i18n';
import { isGenerated, isOpenBusinessReading, type StatementReading } from './statement-reading';
import { sumAmounts } from './statement-sum';

/** حالة الكشف للعرض: «لسه ما اتعملش» لما مفيش كشف متولّد للشهر، والمعتمد والمصروف للشهر المغلق. */
export type StatementStatus = 'NONE' | 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';

/** حالة زرار: مخفي، شغّال، أو ظاهر ومقفول بسبب. */
export type ActionState = 'hidden' | 'enabled' | 'disabled';

/** الأزرار اللي الحالة بتسمح بيها لقارئ النشاط كله. */
export interface StatementActions {
  generate: ActionState;
  review: ActionState;
  returnToDraft: ActionState;
  approve: ActionState;
}

const STATUS_KEYS: Record<StatementStatus, MessageKey> = {
  NONE: 'commissionStatementScreen.statusNone',
  DRAFT: 'commissionStatementScreen.statusDraft',
  REVIEWED: 'commissionStatementScreen.statusReviewed',
  APPROVED: 'commissionStatementScreen.statusApproved',
  PAID: 'commissionStatementScreen.statusPaid',
};

/** مفتاح نص الحالة. */
export function statusKey(status: StatementStatus): MessageKey {
  return STATUS_KEYS[status];
}

/** حالة الكشف المعروضة: كشف مفتوح لسه ما اتولّدش هو «لسه ما اتعملش». */
export function statusOf(reading: StatementReading): StatementStatus {
  if (!isGenerated(reading)) return 'NONE';
  return reading.status;
}

/** هل في موظفة عندها مشكلة بتمنع المراجعة والاعتماد. */
export function hasBlockingIssues(reading: StatementReading): boolean {
  return reading.employees.some((employee) => employee.issues.length > 0);
}

/** زرار يظهر بس في حالته: شغّال، أو مقفول لما السبب موجود قدام المستخدم (مشكلة أو تغيّر بعد المراجعة). */
function whenIn(status: StatementStatus, shownIn: StatementStatus, blocked: boolean): ActionState {
  if (status !== shownIn) return 'hidden';
  return blocked ? 'disabled' : 'enabled';
}

/**
 * الأزرار حسب الحالة: قارئ الفروع والشهر المغلق ما فيهومش كتابة، والمراجعة مقفولة وفي المشاكل، والاعتماد
 * مقفول وفي مشاكل أو تغيّر بعد المراجعة (هيرفضه السيرفر ببصمة قديمة)، والإرجاع للكشف المراجَع بس.
 * الصلاحية نفسها بيفحصها السيرفر؛ هنا بنخفي بس اللي مش بيتنفّذ أصلاً في الحالة دي.
 */
export function statementActions(reading: StatementReading): StatementActions {
  if (!isOpenBusinessReading(reading)) {
    return { generate: 'hidden', review: 'hidden', returnToDraft: 'hidden', approve: 'hidden' };
  }
  const status = statusOf(reading);
  const blocked = hasBlockingIssues(reading);
  return {
    generate: 'enabled',
    review: whenIn(status, 'DRAFT', blocked),
    returnToDraft: whenIn(status, 'REVIEWED', false),
    approve: whenIn(status, 'REVIEWED', blocked || reading.changed_since_review),
  };
}

/** نفس الأزرار لكن كل شغّال بقى مقفول: الكشف المعروض ممكن يكون قديم لحد ما يتحمّل تاني. */
export function switchedOff(actions: StatementActions): StatementActions {
  const off = (state: ActionState): ActionState => (state === 'enabled' ? 'disabled' : state);
  return {
    generate: off(actions.generate),
    review: off(actions.review),
    returnToDraft: off(actions.returnToDraft),
    approve: off(actions.approve),
  };
}

/** نص نوع الصف من كتالوج الكشف نفسه (نفس تسميات ملف الإكسل). */
export function kindKey(kind: CommissionStatementRow['kind']): MessageKey {
  const keys: Record<CommissionStatementRow['kind'], MessageKey> = {
    COMMISSION: 'commissionStatement.kindCommission',
    SALE: 'commissionStatement.kindSale',
    TIP_CARD: 'commissionStatement.kindTipCard',
    TIP_CASH: 'commissionStatement.kindTipCash',
    CORRECTION: 'commissionStatement.kindCorrection',
    CORRECTION_TIP_CARD: 'commissionStatement.kindCorrectionTipCard',
    CORRECTION_TIP_CASH: 'commissionStatement.kindCorrectionTipCash',
    CARRY_COMMISSION: 'commissionStatement.kindCarryCommission',
    CARRY_TIP_CARD: 'commissionStatement.kindCarryTipCard',
  };
  return keys[kind];
}

/** اسم الموظفة بلغة الشاشة: العربي لو موجود، وإلا الإنجليزي (مطلوب دايمًا). */
export function employeeName(employee: CommissionStatementEmployee, locale: Locale): string {
  return locale === 'ar' ? (employee.name_ar ?? employee.name_en) : employee.name_en;
}

/**
 * مبلغ الكشف للعرض: 3 خانات عشرية وفاصل آلاف، من غير أي حساب في المتصفح. المجاميع جاية بنمط أوسع من
 * سقف Money (حتى 16 رقم)، فالتجميع على النص نفسه بدل تحويله لـ Money اللي بيرفض اللي فوق السقف.
 */
export function formatAmount(amount: string): string {
  const sign = amount.startsWith('-') ? '-' : '';
  const [whole = '', fraction = ''] = amount.slice(sign.length).split('.');
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/** تجميع صفوف الموظفة في أقسام العرض. */
export interface StatementRowGroups {
  work: CommissionStatementRow[];
  tips: CommissionStatementRow[];
  corrections: CommissionStatementRow[];
  carries: CommissionStatementRow[];
}

/** القسم اللي بيتعرض فيه كل نوع صف. */
const GROUP_OF: Record<CommissionStatementRow['kind'], keyof StatementRowGroups> = {
  COMMISSION: 'work',
  SALE: 'work',
  TIP_CARD: 'tips',
  TIP_CASH: 'tips',
  CORRECTION: 'corrections',
  CORRECTION_TIP_CARD: 'corrections',
  CORRECTION_TIP_CASH: 'corrections',
  CARRY_COMMISSION: 'carries',
  CARRY_TIP_CARD: 'carries',
};

/** بيوزّع صفوف الموظفة على الأقسام بترتيب الرد نفسه. */
export function groupRows(rows: readonly CommissionStatementRow[]): StatementRowGroups {
  const groups: StatementRowGroups = { work: [], tips: [], corrections: [], carries: [] };
  for (const row of rows) groups[GROUP_OF[row.kind]].push(row);
  return groups;
}

/**
 * مجموع قسم التصحيحات للموظفة: العمولة وبقشيش الكارت بس، لأن بقشيش الكاش للعلم وما بيدخلش في اللي يتصرف.
 * العقد ما بيرجّعش المجموع، فبنجمعه من صفوف القسم من غير سقف الصف الواحد (`sumAmounts`).
 */
export function correctionsTotal(rows: readonly CommissionStatementRow[]): string {
  const counted = rows.filter((row) => row.kind !== 'CORRECTION_TIP_CASH');
  return formatAmount(sumAmounts(counted.map((row) => row.amount)));
}

/** تاريخ صف التصحيح: يوم البند الأصلي لو معروف، وإلا يوم عمل التصحيح. */
export function correctionDate(row: CommissionStatementRow): string | null {
  return row.business_date ?? row.source_business_date;
}

/** اسم الخدمة بلغة الشاشة، أو null لو الصف مش بند خدمة. */
export function serviceName(row: CommissionStatementRow, locale: Locale): string | null {
  return locale === 'ar' ? (row.service_name_ar ?? row.service_name_en) : (row.service_name_en ?? row.service_name_ar);
}

/** اسم الفرع اللي اتعمل فيه الشغل بلغة الشاشة. */
export function branchName(row: CommissionStatementRow, locale: Locale): string | null {
  return locale === 'ar'
    ? (row.source_branch_name_ar ?? row.source_branch_name_en)
    : (row.source_branch_name_en ?? row.source_branch_name_ar);
}
