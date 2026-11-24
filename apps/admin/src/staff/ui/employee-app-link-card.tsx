'use client';
import { t } from '@pospay/i18n';
import { Card } from '@pospay/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeAppLinkActions } from './employee-app-link-actions';

/** كارت صفحة رابط تطبيق الموظفين: اسم النشاط والرابط والرمز والإجراءات. */
export function EmployeeAppLinkCard({
  link,
  businessName,
}: {
  link: string;
  businessName: string;
}) {
  const locale = useLocale();
  return (
    <Card className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <p className="text-sm text-muted-foreground">{t(locale, 'employeeAppLink.business')}</p>
        <p className="font-medium">{businessName}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t(locale, 'employeeAppLink.link')}</p>
        <p className="break-all font-mono text-start" dir="ltr">
          {link}
        </p>
      </div>
      <div
        role="img"
        aria-label={t(locale, 'employeeAppLink.qrLabel')}
        className="w-fit max-w-full rounded-interactive border border-border bg-white p-4"
      >
        <QRCodeSVG value={link} size={256} marginSize={4} className="h-auto max-w-full" />
      </div>
      <EmployeeAppLinkActions link={link} businessName={businessName} />
    </Card>
  );
}
