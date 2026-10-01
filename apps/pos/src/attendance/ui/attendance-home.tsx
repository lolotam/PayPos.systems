import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

export function AttendanceHome({ branchId }: { branchId: string }) {
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-start text-lg font-bold">{t(locale, 'pos.attendanceTitle')}</h1>
      <p className="text-start text-sm text-muted-foreground">{t(locale, 'pos.attendanceLater')}</p>
      <p className="text-start text-sm">
        <span>{t(locale, 'pos.branchLabel')}</span>
        <span className="ms-2 font-mono">{branchId}</span>
      </p>
    </section>
  );
}
