'use client';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/** الكشف حين تُرفض صلاحية الفرع: الترويسة في مكانها والرسالة تحتها بدل نموذج بلا فائدة. */
export function AttendanceStatementNoAccess() {
  const locale = useLocale();
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'attendanceStatementScreen.title')} />
      <p role="alert">{t(locale, 'attendanceStatementScreen.noAccess')}</p>
    </PageShell>
  );
}
