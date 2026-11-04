import { ServiceError } from './errors.ts';
import type { ServiceCommissionRule } from './service-commission-rule.ts';
import { parseServicePrice, toCommissionRule } from './service.ts';
import { validateServiceCommissionRule } from './service-validation.ts';

/** خلية بنيوية وفق FR-005؛ الأرقام لا تعبر حد القارئ كقيم JavaScript. */
export type ServiceImportCommissionCell =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'numeric'; readonly text: string; readonly percentFormat: boolean }
  | { readonly kind: 'numeric-unrepresentable'; readonly display: string }
  | { readonly kind: 'error' }
  | null;

/** رفض محلي؛ اختيار كود النقل للقيمة المطلوبة مسؤولية التكامل. */
export type ServiceImportCommissionRefusal = {
  readonly column: 'commission_rule' | 'commission_value';
  readonly reason: 'CELL_INVALID' | 'RULE_INVALID' | 'VALUE_INVALID' | 'REQUIRED';
};

/** نتيجة التحويل الصافي مع علامة الافتراضي التي تحتاجها المعاينة. */
export type ServiceImportCommissionResult =
  | { readonly ok: true; readonly rule: ServiceCommissionRule; readonly defaulted: boolean }
  | { readonly ok: false; readonly errors: readonly ServiceImportCommissionRefusal[] };

function cellText(cell: ServiceImportCommissionCell): string | null {
  return cell?.kind === 'text' || cell?.kind === 'numeric' ? cell.text.trim() : null;
}

function blank(cell: ServiceImportCommissionCell): boolean {
  return cell === null || cellText(cell) === '';
}

function refusal(
  column: ServiceImportCommissionRefusal['column'],
  reason: ServiceImportCommissionRefusal['reason'],
): ServiceImportCommissionResult {
  return { ok: false, errors: [{ column, reason }] };
}

function percentRule(cell: ServiceImportCommissionCell): ServiceCommissionRule | null {
  const text = cellText(cell);
  if (text === null || !/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return null;
  const [whole = '0', rawFraction = ''] = text.split('.');
  const formatted = cell?.kind === 'numeric' && cell.percentFormat;
  const places = formatted ? 4 : 2;
  const fraction = formatted ? rawFraction.replace(/0+$/, '') : rawFraction;
  if (fraction.length > places) return null;
  const value = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
  const rule = { kind: 'PCT', value } as const;
  validateServiceCommissionRule(rule);
  return rule;
}

function fixedRule(cell: ServiceImportCommissionCell): ServiceCommissionRule | null {
  const text = cellText(cell);
  if (text === null || !/^[0-9]+(?:\.[0-9]{1,3})?$/.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  const canonical = `${whole.replace(/^0+(?=[0-9])/, '')}.${fraction.padEnd(3, '0')}`;
  parseServicePrice(canonical);
  return toCommissionRule({ kind: 'FIXED', value: canonical });
}

/**
 * يحوّل خليتي العمولة وفق FR-005/006 دون تقريب أو حساب مال عائم.
 * الخلية المكسورة لا تتحول لافتراضي، وفحص النطاق النهائي يبقى لقواعد الخدمة.
 *
 * @param ruleCell خلية نوع القاعدة الموسومة أو الفراغ
 * @param valueCell خلية القيمة الموسومة أو الفراغ
 * @returns قاعدة صافية وعلامة الافتراضي، أو أسباب الرفض لكل عمود
 */
export function parseServiceImportCommissionCells(
  ruleCell: ServiceImportCommissionCell,
  valueCell: ServiceImportCommissionCell,
): ServiceImportCommissionResult {
  const errors: ServiceImportCommissionRefusal[] = [];
  if (ruleCell?.kind === 'error') {
    errors.push({ column: 'commission_rule', reason: 'CELL_INVALID' });
  }
  if (valueCell?.kind === 'error') {
    errors.push({ column: 'commission_value', reason: 'CELL_INVALID' });
  }
  const defaulted = blank(ruleCell);
  const kind = defaulted ? 'FOLLOW_PLAN' : cellText(ruleCell)?.toUpperCase();
  if (ruleCell?.kind !== 'error' && !['FOLLOW_PLAN', 'ZERO', 'PCT', 'FIXED'].includes(kind ?? '')) {
    errors.push({ column: 'commission_rule', reason: 'RULE_INVALID' });
  }
  if (valueCell?.kind === 'boolean' || valueCell?.kind === 'numeric-unrepresentable') {
    errors.push({ column: 'commission_value', reason: 'VALUE_INVALID' });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (kind === 'FOLLOW_PLAN' || kind === 'ZERO') {
    if (!blank(valueCell)) return refusal('commission_value', 'VALUE_INVALID');
    const rule = toCommissionRule({ kind });
    validateServiceCommissionRule(rule);
    return { ok: true, rule, defaulted };
  }
  if (blank(valueCell)) return refusal('commission_value', 'REQUIRED');
  try {
    const rule = kind === 'PCT' ? percentRule(valueCell) : fixedRule(valueCell);
    if (rule === null) return refusal('commission_value', 'VALUE_INVALID');
    validateServiceCommissionRule(rule);
    return { ok: true, rule, defaulted };
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return refusal('commission_value', 'VALUE_INVALID');
  }
}
