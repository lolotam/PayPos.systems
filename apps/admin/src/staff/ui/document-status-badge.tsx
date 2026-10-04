'use client';
import type { EmployeeDocumentStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

const VARIANTS = {
  NO_EXPIRY: 'neutral',
  VALID: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'danger',
} as const;

export function DocumentStatusBadge({ status }: { status: EmployeeDocumentStatus }) {
  const locale = useLocale();
  return (
    <Badge variant={VARIANTS[status]}>{t(locale, `employeeDocuments.status_${status}`)}</Badge>
  );
}
