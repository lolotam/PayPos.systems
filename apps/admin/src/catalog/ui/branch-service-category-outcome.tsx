'use client';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

export type BranchCategoryOutcome = {
  categoryId: string;
  name: string;
  kind: 'hidden' | 'enabled' | 'created' | 'shared' | 'refused';
  error?: unknown;
};

const OUTCOME_KEY = {
  hidden: 'catalogServiceCategoryBranches.hidden',
  enabled: 'catalogServiceCategoryBranches.enabled',
  created: 'catalogServiceCategories.created',
  shared: 'catalogServiceCategoryBranches.shared',
} as const;

/**
 * سطر نتيجة آخر كتابة في القسم. القسم هو اللي بيحتفظ بيه مش البند، لأن البند
 * بيكسح من القايمة بعد النجاح أو بعد رفض بيعيد التحميل — الرسالة اللي جوه
 * البند كانت هتضيع معاه. اسم التصنيف بيظهر في السطر عشان يبان انتهى إيه بالظبط.
 */
export function BranchServiceCategoryOutcome({
  outcome,
}: {
  outcome: BranchCategoryOutcome | null;
}) {
  const locale = useLocale();
  if (!outcome) return null;
  if (outcome.kind === 'refused')
    return (
      <p role="alert">
        <bdi>{outcome.name}</bdi> — {envelopeMessage(outcome.error, locale)}
      </p>
    );
  return (
    <p role="status">
      <bdi>{outcome.name}</bdi> — {t(locale, OUTCOME_KEY[outcome.kind])}
    </p>
  );
}
