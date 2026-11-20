import {
  createCommissionServiceOverrideInput,
  type CommissionOverrideServiceCurrentOverride,
  type ServiceCommissionRuleInput,
} from '@pospay/contracts';
import { localDate } from '@pospay/i18n';
import { parseBps, parseKwd } from './plan-draft';

/** أنواع قاعدة العمولة: مصدرها العقد نفسه، فالنوع الخامس مش ممكن يتفتح من غير تغيير العقد. */
export type OverrideKind = ServiceCommissionRuleInput['kind'];

/** مسودة التجاوز: كل القيم نصوص عشان ما فيش رقم بيمسك فلوس. */
export type OverrideDraft = {
  kind: OverrideKind;
  bps: string;
  amount: string;
  effectiveFrom: string;
};

/** كود خطأ الحقل: كل خطأ في المسودة ليه كود واحد في الكتالوج. */
export type OverrideFieldErrorCode = 'INVALID_DATE' | 'INVALID_BPS' | 'INVALID_MONEY';

export type OverrideField = 'effectiveFrom' | 'bps' | 'amount';

export type OverrideFieldError = { field: OverrideField; code: OverrideFieldErrorCode };

/** نتيجة بناء جسم الحفظ: تحليل العقد، وأخطاء الحقول اللي منعت الإرسال. */
export interface OverrideBodyResult {
  parsed: ReturnType<typeof createCommissionServiceOverrideInput.safeParse>;
  errors: OverrideFieldError[];
}

/**
 * يبني مسودة التجاوز من التجاوز الحالي: مفيش تجاوز معناه نسبة فاضية عشان ما يتحفظش شي من
 * غير ما المدير يكتب قيمة (CM-12)، وتاريخ البداية دايمًا يوم النشاط مش تاريخ السطر.
 */
export function overrideDraft(
  current: CommissionOverrideServiceCurrentOverride | null,
  timeZone: string,
  now: Date,
): OverrideDraft {
  const day = localDate(now, timeZone);
  const draft: OverrideDraft = { kind: 'PCT', bps: '', amount: '', effectiveFrom: day };
  if (current === null) return draft;
  draft.kind = current.rule.kind;
  if (current.rule.kind === 'PCT') draft.bps = String(current.rule.value);
  if (current.rule.kind === 'FIXED') draft.amount = current.rule.value;
  return draft;
}

type ReadRule =
  { ok: true; rule: ServiceCommissionRuleInput } | { ok: false; error: OverrideFieldError };

/** القاعدة المقروءة: القيمة اللي مش سليمة بتترك من الجسم عشان العقد يرفضها. */
function readRule(draft: OverrideDraft): ReadRule {
  if (draft.kind === 'PCT') {
    const bps = parseBps(draft.bps);
    if (bps === null) return { ok: false, error: { field: 'bps', code: 'INVALID_BPS' } };
    return { ok: true, rule: { kind: 'PCT', value: bps } };
  }
  if (draft.kind !== 'FIXED') return { ok: true, rule: { kind: draft.kind } };
  const amount = parseKwd(draft.amount);
  if (amount === null) return { ok: false, error: { field: 'amount', code: 'INVALID_MONEY' } };
  return { ok: true, rule: { kind: 'FIXED', value: amount } };
}

/** رفض العقد بيرجّع على الحقل اللي رفضه: التاريخ بتاعه، وقيمة القاعدة حسب نوعها. */
function contractFieldError(draft: OverrideDraft, head: string): OverrideFieldError | null {
  if (head === 'effective_from') return { field: 'effectiveFrom', code: 'INVALID_DATE' };
  if (head !== 'rule') return null;
  if (draft.kind === 'PCT') return { field: 'bps', code: 'INVALID_BPS' };
  return draft.kind === 'FIXED' ? { field: 'amount', code: 'INVALID_MONEY' } : null;
}

/**
 * يبني جسم حفظ التجاوز: قراءة النص أولًا، وبعدين العقد هو اللي بيقرر. أي خطأ في القراءة أو
 * في العقد بيبقى خطأ على الحقل المعني، فما يتحفظش جسم ناقص من غير ما يشوف المدير.
 */
export function toOverrideBody(draft: OverrideDraft, serviceId: string): OverrideBodyResult {
  const errors: OverrideFieldError[] = [];
  const effectiveFrom = draft.effectiveFrom.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom))
    errors.push({ field: 'effectiveFrom', code: 'INVALID_DATE' });
  const rule = readRule(draft);
  if (!rule.ok) errors.push(rule.error);
  const candidate = rule.ok
    ? { service_id: serviceId, rule: rule.rule, effective_from: effectiveFrom }
    : { service_id: serviceId, effective_from: effectiveFrom };
  const parsed = createCommissionServiceOverrideInput.safeParse(candidate);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const mapped = contractFieldError(draft, String(issue.path[0] ?? ''));
      if (mapped !== null && !errors.some((error) => error.field === mapped.field))
        errors.push(mapped);
    }
  return { parsed, errors };
}
