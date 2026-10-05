import { t } from '@pospay/i18n';
import { QRCodeSVG } from 'qrcode.react';

import { useLocale } from '@/shared/locale/locale-context';

export function AttendanceQr({ payload }: { payload: string }) {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-80 rounded-card border border-border bg-white p-6 text-black">
      <QRCodeSVG
        value={payload}
        size={288}
        level="M"
        marginSize={4}
        role="img"
        aria-label={t(locale, 'pos.attendanceQrLabel')}
        className="h-auto w-full"
      />
    </div>
  );
}
