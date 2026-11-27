import {
  commissionRepairPlan,
  createCommissionPlanVersionInput,
  type CreateCommissionPeriodRepairInput,
  type CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import type { CommissionPlanWire } from '@pospay/commissions-engine/validation';
import { t, type Locale } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';
import { checkPlanBlocks } from './plan-check';
import type { DraftBlock, PlanDraft, RepairPlanDraft, WireCandidateResult } from './plan-draft';
import { toRepairWireCandidate, toWireCandidate } from './plan-draft';
import { DRAFT_ERROR_KEYS, PLAN_ERROR_KEYS } from './plan-messages';

const BLOCK_PATHS: Record<string, DraftBlock> = {
  effective_from: 'effectiveFrom',
  base: 'base',
  tiers: 'tiers',
  package_sale: 'packageSale',
};

/** جسم الخطة المقبول من العقد، وبه البلوكات الثلاثة اللي بيفحصها المحرك. */
type PlanBody = CommissionPlanWire;

/** السكيما اللي بيحتاجها المقرر: `safeParse` وبس، فأي سكيما عقد بتركّب من غير ما الشاشة تعتمد على مكتبة السكيما. */
interface PlanSchema<TBody> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: TBody }
    | { success: false; error: { issues: readonly { path: readonly PropertyKey[] }[] } };
}

function fieldError(message: string) {
  return { type: 'validation' as const, message };
}

function setMessage(errors: object, block: DraftBlock, message: string): void {
  Object.assign(errors, { [block]: fieldError(message) });
}

function hasMessage(errors: object, block: DraftBlock): boolean {
  const error = (errors as Record<string, { message?: unknown }>)[block];
  return typeof error?.message === 'string';
}

/**
 * مقرر النموذج المشترك: أخطاء قراءة الحقول أولاً، ثم سكيما العقد، ثم قواعد المحرك لكل بلوك؛ الرسالة بتتحط
 * على بلوكها والأولى هي اللي بتفضل. الاختلاف الوحيد بين الخطة العادية وخطة الإصلاح هو الجسم والسكيما.
 *
 * @param locale لغة الرسائل
 * @param toCandidate يبني الجسم المرشّح من المسودة
 * @param schema سكيما العقد اللي بتقرر شكل الجسم
 * @returns مقرر react-hook-form
 */
function createResolver<TDraft extends RepairPlanDraft, TBody extends PlanBody>(
  locale: Locale,
  toCandidate: (draft: TDraft) => WireCandidateResult,
  schema: PlanSchema<TBody>,
): Resolver<TDraft, unknown, TBody> {
  return (values) => {
    const built = toCandidate(values);
    const errors: FieldErrors<TDraft> = {};
    for (const error of built.errors)
      setMessage(errors, error.block, t(locale, DRAFT_ERROR_KEYS[error.code]));
    const parsed = schema.safeParse(built.candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const block = BLOCK_PATHS[String(issue.path[0] ?? '')];
        if (block === undefined || hasMessage(errors, block)) continue;
        setMessage(
          errors,
          block,
          t(
            locale,
            block === 'effectiveFrom'
              ? 'commissionPlanBuilder.errorInvalidDate'
              : 'commissionPlanBuilder.errorInvalidPlan',
          ),
        );
      }
      // كود العقد اللي ملوش بلوك معروف (زي whole_period) بيقفل البوابة برسالة عامة بدل ما يرجع الفورم صالح فجأة.
      if (Object.keys(errors).length === 0)
        setMessage(errors, 'base', t(locale, 'commissionPlanBuilder.errorInvalidPlan'));
      return { values: {}, errors };
    }
    const blocks = checkPlanBlocks(parsed.data);
    for (const block of ['base', 'tiers', 'packageSale'] as const) {
      const code = blocks[block];
      if (code !== null && !hasMessage(errors, block)) {
        setMessage(errors, block, t(locale, PLAN_ERROR_KEYS[code]));
      }
    }
    return Object.keys(errors).length > 0
      ? { values: {}, errors }
      : { values: parsed.data, errors: {} };
  };
}

/** مقرر نموذج الخطة العادية: الجسم الكامل بتاريخ السريان وكامل الفترة. */
export function createPlanResolver(
  locale: Locale,
): Resolver<PlanDraft, unknown, CreateCommissionPlanVersionInput> {
  return createResolver(locale, toWireCandidate, createCommissionPlanVersionInput);
}

/** مقرر نموذج خطة الإصلاح: البلوكات الثلاثة بس، بسكيما `commissionRepairPlan` اللي بترفض أي مفتاح زيادة. */
export function createRepairPlanResolver(
  locale: Locale,
): Resolver<RepairPlanDraft, unknown, CreateCommissionPeriodRepairInput['plan']> {
  return createResolver(locale, toRepairWireCandidate, commissionRepairPlan);
}
