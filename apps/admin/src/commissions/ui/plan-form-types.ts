import type { UseFormReturn } from 'react-hook-form';
import type { PlanDraft } from '../model/plan-draft';

/** مسارات حقول طريقة الحساب بين البلوكات وشرائح tiers. */
export type CalcPath = 'base.calc' | 'packageSale.calc' | `tiers.steps.${number}.calc`;

/** مسار حقول شريحة واحدة في tiers. */
export type StepPath = `tiers.steps.${number}`;

export type PlanForm = UseFormReturn<PlanDraft>;
