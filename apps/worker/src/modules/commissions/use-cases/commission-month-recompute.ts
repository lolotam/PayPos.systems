import {
  assembleCommissionPeriodInput,
  computePeriod,
  type CommissionPeriodProjection,
} from '@pospay/commissions-engine';

import type { CommissionRecomputedSource } from '../domain/commission-correction-step.ts';
import { commissionSourceKind, commissionTipSourceRef } from '../domain/commission-source-ref.ts';

/**
 * نتيجة إعادة حساب شهر واحد: المصادر المعاد حسابها بالمحرك، أو سبب الرفض
 * اللي بيمنع صرف نتيجة جزئية (NO_PLAN و NO_SALARY).
 */
export type CommissionMonthRecomputeResult =
  | { readonly ok: true; readonly sources: readonly CommissionRecomputedSource[] }
  | { readonly ok: false; readonly code: 'NO_PLAN' | 'NO_SALARY' };

/** يرتّب المصادر بالمرجع ثم بالنوع، فالترتيب ما يعتمدش على ترتيب المدخلات. */
function bySourceRef(left: CommissionRecomputedSource, right: CommissionRecomputedSource): number {
  if (left.sourceRef !== right.sourceRef) return left.sourceRef < right.sourceRef ? -1 : 1;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return 0;
}

/**
 * يعيد حساب شهر الموظفة بمدخلاتها الحالية (D-1): يجمع مدخل المحرك من الإسقاط
 * ويسعّره، والبِقشيش بيعدّي من غير تسعير لأن المحرك ما بيسعّرش البقشيش.
 * البند الملغى ما بيوصلش للتسعير، فمش بيبقى في المصادر المعادة.
 * سبب الرفض بيرجع زي ما جه من المحرك، لأن شهر ناقص الإعداد ما ينفعش ينشر تصحيح.
 *
 * @param projection إسقاط الموظفة وشهرها كما يقرأه النطاق
 * @returns المصادر المعاد حسابها مرتبة، أو سبب الرفض
 */
export function recomputeCommissionMonth(
  projection: CommissionPeriodProjection,
): CommissionMonthRecomputeResult {
  const assembled = assembleCommissionPeriodInput(projection);
  const computed = computePeriod(assembled.input);
  if (!computed.ok) return { ok: false, code: computed.code };

  const sources: CommissionRecomputedSource[] = [];
  for (const [sourceRef, amount] of computed.perSource) {
    sources.push({ sourceRef, kind: commissionSourceKind(sourceRef), amount });
  }
  for (const tip of assembled.tips) {
    const sourceRef = commissionTipSourceRef(tip.sessionId, tip.method);
    sources.push({ sourceRef, kind: commissionSourceKind(sourceRef), amount: tip.amount });
  }
  return { ok: true, sources: sources.sort(bySourceRef) };
}
