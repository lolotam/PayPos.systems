'use client';

import { t } from '@pospay/i18n';
import { QRCodeSVG } from 'qrcode.react';

import { useLocale } from '@/shared/locale/locale-context';
import { totpSecret } from '../model/totp-secret';

export function EnrolQr({ uri }: { uri: string }) {
  const locale = useLocale();
  const secret = totpSecret(uri);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-start text-sm">{t(locale, 'admin.enrolQrLabel')}</p>
      <div className="w-fit max-w-full rounded-interactive border border-border bg-white p-4">
        <QRCodeSVG value={uri} size={192} marginSize={4} className="h-auto max-w-full" />
      </div>
      <p className="text-start text-sm">{t(locale, 'admin.manualKeyLabel')}</p>
      <p className="break-all text-start font-mono text-sm">{secret}</p>
    </div>
  );
}
