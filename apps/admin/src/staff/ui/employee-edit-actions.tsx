'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function EmployeeEditActions({
  pending,
  fetching,
  onReload,
  onClose,
}: {
  pending: boolean;
  fetching: boolean;
  onReload: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={pending || fetching} onClick={onReload}>
        {t(locale, 'staff.reload')}
      </Button>
      <Button variant="outline" disabled={pending} onClick={onClose}>
        {t(locale, 'staff.cancel')}
      </Button>
    </div>
  );
}
