import type { LockedCommissionPeriod } from './commission-line-types.ts';

import {
  CommissionCorrectionTargetInputError,
  type CommissionCorrectionTargetRefusal,
} from './errors.ts';

/**
 * صف شهر مقفول بحالته ومعرف كشفه، كما أعادته قفل الشهور بعد اكتمال انتظار الأقفال.
 * اللقطة هي مصدر الحالة الوحيد للاختيار، فلا يُقرأ أي شهر خارج قفله.
 */
export interface CommissionCorrectionCandidate extends LockedCommissionPeriod {
  readonly statementId: string;
}

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

const KNOWN_STATUSES: ReadonlySet<string> = new Set<LockedCommissionPeriod['status']>([
  'DRAFT',
  'REVIEWED',
  'APPROVED',
  'PAID',
]);

/**
 * يتحقق من صيغة الشهر قبل أي مقارنة؛ شهر غير موجود أصلاً لا يصلح مصدراً ولا مرشحاً.
 *
 * @param period قيمة الشهر المراد التحقق منها
 * @param reason سبب الرفض الذي يُسجَّل عند الصيغة الخاطئة
 * @returns لا شيء؛ الصيغة الصحيحة تمر بلا أثر
 */
function assertPeriod(period: string, reason: CommissionCorrectionTargetRefusal): void {
  if (!PERIOD.test(period) || period.startsWith('0000-')) {
    throw new CommissionCorrectionTargetInputError(reason, period);
  }
}

/**
 * يختار هدف التصحيح وفق D-13: أقرب شهر DRAFT يقع بعد الشهر المصدر وداخل الشهر الحالي المحقون.
 * القرار يُتخذ من لقطة مقفولة جاهزة فقط، فلا تُقرأ حالة شهر قبل قفله ولا تُفتح حالة ولا تُقفل.
 * الشهور المراجعة والمقبولة والمدفوعة ليست مفتوحة فلا تنافس DRAFT، ويبقى الفائز أصغر شهر
 * مؤهل لا أول صف في المصفوفة، فالترتيب لا يقرر.
 *
 * @param snapshot لقطة الشهور المقفولة بحالاتها ومعرفاتها، كاملة ومن نداء قفل واحد
 * @param sourcePeriod شهر المصدر الذي وقع فيه التغيير، بصيغة YYYY-MM
 * @param currentPeriod الشهر الحالي المحقون للنشاط، بصيغة YYYY-MM
 * @returns الصف المختار كما ورد في اللقطة، أو null إن لم يوجد شهر مؤهل
 */
export function selectCommissionCorrectionTarget(
  snapshot: readonly CommissionCorrectionCandidate[],
  sourcePeriod: string,
  currentPeriod: string,
): CommissionCorrectionCandidate | null {
  assertPeriod(sourcePeriod, 'INVALID_SOURCE_PERIOD');
  assertPeriod(currentPeriod, 'INVALID_CURRENT_PERIOD');

  const seen = new Map<string, CommissionCorrectionCandidate>();
  let selected: CommissionCorrectionCandidate | null = null;

  for (const row of snapshot) {
    if (!PERIOD.test(row.period) || row.period.startsWith('0000-')) {
      throw new CommissionCorrectionTargetInputError('INVALID_CANDIDATE_PERIOD', row.period);
    }
    if (!KNOWN_STATUSES.has(row.status)) {
      throw new CommissionCorrectionTargetInputError('UNKNOWN_STATUS', row.period);
    }
    if (typeof row.statementId !== 'string' || row.statementId.trim() === '') {
      throw new CommissionCorrectionTargetInputError('MISSING_STATEMENT_ID', row.period);
    }

    const previous = seen.get(row.period);
    if (previous === undefined) {
      seen.set(row.period, row);
    } else if (previous.statementId !== row.statementId || previous.status !== row.status) {
      // نفس الشهر بمُعرّف أو حالة مختلفة: أي واحد منهما قد يُختار، فاللقطة الغامضة تُرفض.
      throw new CommissionCorrectionTargetInputError('AMBIGUOUS_DUPLICATE_PERIOD', row.period);
    }

    if (row.status !== 'DRAFT') continue;
    if (row.period <= sourcePeriod) continue;
    if (row.period > currentPeriod) continue;
    if (selected === null || row.period < selected.period) selected = row;
  }

  return selected;
}
