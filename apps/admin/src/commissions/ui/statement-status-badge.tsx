'use client';

import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { statusKey, type StatementStatus } from '../model/statement-display';

const VARIANTS = {
  NONE: 'neutral',
  DRAFT: 'pending',
  REVIEWED: 'info',
  APPROVED: 'success',
  PAID: 'paid',
} as const;

/** شارة حالة الكشف: لسه ما اتعملش، مسودة، اتراجع، اتعمد، أو اتصرف. */
export function StatementStatusBadge({ status }: { status: StatementStatus }) {
  const locale = useLocale();
  return <Badge variant={VARIANTS[status]}>{t(locale, statusKey(status))}</Badge>;
}
