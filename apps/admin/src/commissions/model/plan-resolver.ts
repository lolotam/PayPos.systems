import {
  createCommissionPlanVersionInput,
  type CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';
import { checkPlanBlocks } from './plan-check';
import type { DraftBlock, PlanDraft } from './plan-draft';
import { toWireCandidate } from './plan-draft';
import { DRAFT_ERROR_KEYS, PLAN_ERROR_KEYS } from './plan-messages';

const BLOCK_PATHS: Record<string, DraftBlock> = {
  effective_from: 'effectiveFrom',
  base: 'base',
  tiers: 'tiers',
  package_sale: 'packageSale',
};

function fieldError(message: string) {
  return { type: 'validation' as const, message };
}

function setMessage(errors: FieldErrors<PlanDraft>, block: DraftBlock, message: string): void {
  Object.assign(errors, { [block]: fieldError(message) });
}

function hasMessage(errors: FieldErrors<PlanDraft>, block: DraftBlock): boolean {
  const error = (errors as Record<string, { message?: unknown }>)[block];
  return typeof error?.message === 'string';
}

export function createPlanResolver(
  locale: Locale,
): Resolver<PlanDraft, unknown, CreateCommissionPlanVersionInput> {
  return (values) => {
    const built = toWireCandidate(values);
    const errors: FieldErrors<PlanDraft> = {};
    for (const error of built.errors)
      setMessage(errors, error.block, t(locale, DRAFT_ERROR_KEYS[error.code]));
    const parsed = createCommissionPlanVersionInput.safeParse(built.candidate);
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
