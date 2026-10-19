'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function CompanyEmployeeNumberEditorActions({ onClose }: { onClose: () => void }) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm">
        {t(locale, 'companyEmployeeNumbers.save')}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onClose}>
        {t(locale, 'companyEmployeeNumbers.close')}
      </Button>
    </div>
  );
}
