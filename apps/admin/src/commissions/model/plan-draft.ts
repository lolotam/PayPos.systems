import type {
  CommissionPlanCalc,
  CommissionPlanComponent,
  CommissionPlanThreshold,
  CommissionPlanTiers,
  CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import { localDate, normalizeKwdInput } from '@pospay/i18n';

export type CalcDraft = { kind: CommissionPlanCalc['kind']; bps: string; amount: string };
export type ComponentDraft = { enabled: boolean; calc: CalcDraft };
export interface StepDraft {
  fromKind: CommissionPlanThreshold['kind'];
  fromValue: string;
  calc: CalcDraft;
}
export interface TiersDraft {
  enabled: boolean;
  /** أول لمسة للإعدادات بتحتفظ بيها لما البلوك يتقفل تاني بدل ما تضيع من اللي كتبه المدير (CM-06). */
  touched: boolean;
  mode: NonNullable<CommissionPlanTiers['mode']>;
  accumulator: NonNullable<CommissionPlanTiers['accumulator']>;
  steps: StepDraft[];
}
/** البلوكات الثلاثة المشتركة بين الخطة العادية وخطة الإصلاح؛ الحقول المشتركة بتشتغل على النوع ده. */
export interface RepairPlanDraft {
  base: ComponentDraft;
  tiers: TiersDraft;
  packageSale: ComponentDraft;
}
/** مسودة الخطة العادية: البلوكات الثلاثة مع تاريخ السريان وكامل الفترة. */
export interface PlanDraft extends RepairPlanDraft {
  effectiveFrom: string;
  wholePeriod: boolean;
}

export type DraftErrorCode =
  'INVALID_DATE' | 'INVALID_BPS' | 'INVALID_MONEY' | 'INVALID_SESSIONS' | 'INVALID_MULTIPLE';
export type DraftBlock = 'base' | 'tiers' | 'packageSale' | 'effectiveFrom';
export interface DraftError {
  block: DraftBlock;
  code: DraftErrorCode;
}
/** جسم الطلب المرشّح للإرسال، مع أخطاء قراءة الحقول؛ الترشيح بيعمل استبدال مؤقت ولا يقرر صحة الخطة. */
export interface WireCandidateResult {
  candidate: unknown;
  errors: DraftError[];
}

// لوحة الكيبورد العربية بتكتب ٥ بدل 5؛ بتتحول ASCII قبل القراءة عشان كل الخانات الرقمية تتقبل زي مبلغ الدينار.
function toAsciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) & 15));
}

function parseInteger(text: string, pattern: RegExp): number | null {
  const trimmed = toAsciiDigits(text.trim());
  return pattern.test(trimmed) ? Number(trimmed) : null;
}

/** يقرأ نص النسبة كنقاط أساس صحيحة، أو يرجع null للنص المرفوض. */
export function parseBps(text: string): number | null {
  return parseInteger(text, /^\d{1,5}$/);
}

/** يقرأ نص المبلغ بالدينار وبيطبّعه لثلاث خانات عشرية، أو يرجع null للنص المرفوض. */
export function parseKwd(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = normalizeKwdInput(toAsciiDigits(trimmed));
  return /^(0|[1-9]\d{0,10})\.\d{3}$/.test(normalized) ? normalized : null;
}

function parseSessions(text: string): number | null {
  return parseInteger(text, /^\d{1,9}$/);
}

function parseMultiple(text: string): string | null {
  const trimmed = toAsciiDigits(text.trim());
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
}

function valueOrError<T>(value: T | null, fallback: T, error: DraftError, errors: DraftError[]): T {
  if (value !== null) return value;
  errors.push(error);
  return fallback;
}

function calcWire(calc: CalcDraft, block: DraftBlock, errors: DraftError[]): CommissionPlanCalc {
  if (calc.kind === 'PCT') {
    const bps = valueOrError(parseBps(calc.bps), 0, { block, code: 'INVALID_BPS' }, errors);
    return { kind: 'PCT', bps };
  }
  const amount = valueOrError(
    parseKwd(calc.amount),
    '0.000',
    { block, code: 'INVALID_MONEY' },
    errors,
  );
  return { kind: 'FIXED', amount };
}

// المقفول بيحتفظ بحسابه لو لسه بيقرى صح، والمعطوب بيتشال من غير خطأ (CM-06) عشان ما يمنعش الحفظ وهو مقفول.
function componentWire(
  draft: ComponentDraft,
  block: DraftBlock,
  errors: DraftError[],
): CommissionPlanComponent {
  if (draft.enabled) return { enabled: true, calc: calcWire(draft.calc, block, errors) };
  const quiet: DraftError[] = [];
  const calc = calcWire(draft.calc, block, quiet);
  return quiet.length === 0 ? { enabled: false, calc } : { enabled: false };
}

const THRESHOLD_RULES = {
  AMOUNT: { parse: parseKwd, code: 'INVALID_MONEY', fallback: '0.000' },
  SESSIONS: { parse: parseSessions, code: 'INVALID_SESSIONS', fallback: 0 },
  SALARY_MULTIPLE: { parse: parseMultiple, code: 'INVALID_MULTIPLE', fallback: '0.00' },
} as const;

function thresholdWire(step: StepDraft, errors: DraftError[]): CommissionPlanThreshold {
  const rule = THRESHOLD_RULES[step.fromKind];
  const value = valueOrError(
    rule.parse(step.fromValue),
    rule.fallback,
    { block: 'tiers', code: rule.code },
    errors,
  );
  return { kind: step.fromKind, value } as CommissionPlanThreshold;
}

// المفعّل بيشتدّ على النص المعطوب برسالة في بلوكه، والملموس المقفول بيحتفظ بالشرائح اللي بتتقرى بس (CM-06).
function tiersWire(draft: TiersDraft, errors: DraftError[]): CommissionPlanTiers {
  if (!draft.enabled && !draft.touched) return { enabled: false };
  const steps = draft.steps.flatMap((step) => {
    const sink = draft.enabled ? errors : [];
    const from = thresholdWire(step, sink);
    const calc = calcWire(step.calc, 'tiers', sink);
    return draft.enabled || sink.length === 0 ? [{ from, calc }] : [];
  });
  return { enabled: draft.enabled, mode: draft.mode, accumulator: draft.accumulator, steps };
}

/**
 * يبني جسم الطلب المرشّح من نصوص المسودة بقراءة حقول فقط: كل نص إما قيمة سليمة لنوعه أو خطأ
 * قراءة معلّم ببلوكه، والاستبدال المؤقت في الجسم بيخلي الترشيح ما يرميش، والقرار للعقد والمحرك.
 *
 * @param draft قيم النموذج النصية
 * @returns الجسم بصيغة العقد مع قائمة أخطاء القراءة
 */
export function toWireCandidate(draft: PlanDraft): WireCandidateResult {
  const errors: DraftError[] = [];
  const effectiveFrom = draft.effectiveFrom.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom))
    errors.push({ block: 'effectiveFrom', code: 'INVALID_DATE' });
  const candidate = {
    effective_from: effectiveFrom,
    whole_period: draft.wholePeriod,
    ...blocksWire(draft, errors),
  };
  return { candidate, errors };
}

/** البلوكات الثلاثة بصيغة العقد مع أخطاء قراءتها، وهي الجزء المشترك بين الخطة العادية وخطة الإصلاح. */
function blocksWire(draft: RepairPlanDraft, errors: DraftError[]) {
  return {
    base: componentWire(draft.base, 'base', errors),
    tiers: tiersWire(draft.tiers, errors),
    package_sale: componentWire(draft.packageSale, 'packageSale', errors),
  };
}

/**
 * يبني جسم طلب الإصلاح المرشّح: البلوكات الثلاثة بس، من غير تاريخ سريان ولا whole_period لأن الإصلاح بيسري
 * في شهره وتاريخه أول الشهر (D-12).
 *
 * @param draft قيم البلوكات النصية
 * @returns الجسم بصيغة العقد مع قائمة أخطاء القراءة
 */
export function toRepairWireCandidate(draft: RepairPlanDraft): WireCandidateResult {
  const errors: DraftError[] = [];
  return { candidate: blocksWire(draft, errors), errors };
}

/** يبدأ مسودة إصلاح فاضية وكل البلوكات معطّلة. */
export function emptyRepairPlanDraft(): RepairPlanDraft {
  return {
    base: { enabled: false, calc: { kind: 'PCT', bps: '', amount: '' } },
    tiers: { enabled: false, touched: false, mode: 'MARGINAL', accumulator: 'AMOUNT', steps: [] },
    packageSale: { enabled: false, calc: { kind: 'PCT', bps: '', amount: '' } },
  };
}

/** يبدأ مسودة فاضية بتاريخ النهارده في توقيت النشاط وكل البلوكات معطّلة. */
export function emptyPlanDraft(timeZone: string, now: Date): PlanDraft {
  return {
    effectiveFrom: localDate(now, timeZone),
    wholePeriod: false,
    ...emptyRepairPlanDraft(),
  };
}

function calcDraft(calc: CommissionPlanCalc | undefined): CalcDraft {
  if (calc === undefined) return { kind: 'PCT', bps: '', amount: '' };
  return calc.kind === 'PCT'
    ? { kind: 'PCT', bps: String(calc.bps), amount: '' }
    : { kind: 'FIXED', bps: '', amount: calc.amount };
}

function componentDraft(component: CommissionPlanComponent): ComponentDraft {
  return { enabled: component.enabled, calc: calcDraft(component.calc) };
}

function tiersDraft(tiers: CommissionPlanTiers): TiersDraft {
  const { enabled, ...settings } = tiers;
  const kept = enabled || Object.values(settings).some((value) => value !== undefined);
  return {
    enabled,
    touched: kept,
    mode: tiers.mode ?? 'MARGINAL',
    accumulator: tiers.accumulator ?? 'AMOUNT',
    steps: (tiers.steps ?? []).map((step) => ({
      fromKind: step.from.kind,
      fromValue: String(step.from.value),
      calc: calcDraft(step.calc),
    })),
  };
}

/** يبني المسودة من نسخة مخزّنة عشان المدير يعدّل عليها بدل ما يبدأ من الصفر. */
export function draftFromVersion(version: CreateCommissionPlanVersionInput): PlanDraft {
  return {
    effectiveFrom: version.effective_from,
    wholePeriod: version.whole_period,
    base: componentDraft(version.base),
    tiers: tiersDraft(version.tiers),
    packageSale: componentDraft(version.package_sale),
  };
}
