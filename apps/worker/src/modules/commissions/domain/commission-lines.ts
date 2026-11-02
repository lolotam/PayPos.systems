import { CommissionLineEventInvalidError } from './errors.ts';
import type {
  CommissionLineEventInput,
  CommissionLineSnapshot,
  CommissionRuleColumns,
  HeldCommissionLineHead,
} from './commission-line-types.ts';

/**
 * يفحص هويات البنود والمنفّذين قبل أي قفل أو حساب؛ حدث واحد لا يكرر بنداً أو موظفة
 * ولا يخلط نشاطين، ولا يخلط بنوداً من جلسات مختلفة، وحصص كل بند تساوي 10000 bps
 * حتى لا يضيع أو يتضاعف صافي.
 *
 * @param input الحدث الموحّد بكل لقطات بنوده
 * @returns لا شيء عند صحة الحدث، ويرمي CommissionLineEventInvalidError عند أول مخالفة
 */
export function validateCommissionLineEvent(input: CommissionLineEventInput): void {
  const lineIds = new Set<string>();
  for (const line of input.lines) {
    if (lineIds.has(line.lineId)) {
      throw new CommissionLineEventInvalidError('DUPLICATE_LINE_ID', line.lineId);
    }
    lineIds.add(line.lineId);
    if (line.businessId !== input.businessId) {
      throw new CommissionLineEventInvalidError('LINE_BUSINESS_MISMATCH', line.lineId);
    }
    if (line.sessionId !== input.sessionId) {
      throw new CommissionLineEventInvalidError('LINE_SESSION_MISMATCH', line.lineId);
    }
    validatePerformers(line);
  }
}

function validatePerformers(line: CommissionLineSnapshot): void {
  const employeeIds = new Set<string>();
  let totalBps = 0;
  for (const performer of line.performers) {
    if (employeeIds.has(performer.employeeId)) {
      throw new CommissionLineEventInvalidError('DUPLICATE_PERFORMER', line.lineId);
    }
    employeeIds.add(performer.employeeId);
    totalBps += performer.shareBps;
  }
  if (totalBps !== 10000) {
    throw new CommissionLineEventInvalidError('PERFORMER_SHARE_SUM', line.lineId);
  }
}

/**
 * يختار اللقطات الأحدث فقط من الحالة المقروءة بعد أقفال الهوية؛ المراجعة المساوية
 * أو الأقدم no-op، وغياب الرأس يعني أن لقطة التسجيل الأولى جديدة.
 *
 * @param lines اللقطات الواردة في الحدث
 * @param heads رؤوس البنود المحفوظة بعد أخذ أقفالها
 * @returns اللقطات التي يجب استبدال صفوفها، بترتيب الحدث نفسه
 */
export function selectNewerCommissionLines(
  lines: readonly CommissionLineSnapshot[],
  heads: readonly HeldCommissionLineHead[],
): CommissionLineSnapshot[] {
  const revisions = new Map(heads.map((head) => [head.lineId, head.revision]));
  return lines.filter((line) => line.revision > (revisions.get(line.lineId) ?? 0));
}

/**
 * يحسب شهور الحذف والإضافة للبنود الأحدث؛ تغيّر business_date يلمس شهر الرأس
 * المحفوظ وشهر اللقطة الجديدة حتى لا يبقى أثر البند في شهر واحد فقط.
 *
 * @param lines اللقطات الأحدث التي ستُكتب
 * @param heads الرؤوس المحفوظة قبل الاستبدال
 * @returns الشهور المتأثرة، فريدة ومرتبة تصاعدياً
 */
export function affectedCommissionPeriods(
  lines: readonly CommissionLineSnapshot[],
  heads: readonly HeldCommissionLineHead[],
): string[] {
  const heldPeriods = new Map(heads.map((head) => [head.lineId, head.period]));
  const periods = new Set<string>();
  for (const line of lines) {
    const heldPeriod = heldPeriods.get(line.lineId);
    if (heldPeriod !== undefined) periods.add(heldPeriod);
    periods.add(periodOfBusinessDate(line.businessDate));
  }
  return [...periods].sort();
}

/**
 * يشتق شهر الكشف من تاريخ النشاط المحفوظ في الحدث؛ لا يحوّل أي instant إلى تاريخ.
 *
 * @param businessDate تاريخ النشاط بصيغة YYYY-MM-DD
 * @returns الشهر المحاسبي بصيغة YYYY-MM
 */
export function periodOfBusinessDate(businessDate: string): string {
  return businessDate.slice(0, 7);
}

/**
 * يحوّل لقطة قاعدة الخدمة إلى أعمدة التخزين المتخصصة؛ PCT وحدها تحمل bps
 * وFIXED وحدها تحمل مبلغاً، وباقي الأنواع تُبقي العمودين null.
 *
 * @param rule لقطة قاعدة الخدمة من الحدث
 * @returns أعمدة rule_kind وrule_pct_bps وrule_fixed_amount
 */
export function commissionRuleColumns(
  rule: CommissionLineSnapshot['ruleSnapshot'],
): CommissionRuleColumns {
  if (rule.kind === 'PCT') {
    return { ruleKind: rule.kind, rulePctBps: rule.value, ruleFixedAmount: null };
  }
  if (rule.kind === 'FIXED') {
    return { ruleKind: rule.kind, rulePctBps: null, ruleFixedAmount: rule.value };
  }
  return { ruleKind: rule.kind, rulePctBps: null, ruleFixedAmount: null };
}
