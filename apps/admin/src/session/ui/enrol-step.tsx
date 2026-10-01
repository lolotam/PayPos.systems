'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import Link from 'next/link';

import { useLocale } from '@/shared/locale/locale-context';

import type { EnrolController } from '../api/use-enrol-totp';
import { BackupCodes } from './backup-codes';
import { EnrolQr } from './enrol-qr';
import { PasswordConfirmForm } from './password-confirm-form';
import { TotpForm } from './totp-form';

export function EnrolStep({ enrol }: { enrol: EnrolController }) {
  const locale = useLocale();
  if (enrol.step.kind === 'password') {
    return (
      <PasswordConfirmForm pending={enrol.pending} error={enrol.error} onSubmit={enrol.start} />
    );
  }
  if (enrol.step.kind === 'verify') {
    return (
      <div className="flex flex-col gap-4">
        <EnrolQr uri={enrol.step.totpURI} />
        <BackupCodes codes={enrol.step.backupCodes} />
        <TotpForm pending={enrol.pending} error={enrol.error} onSubmit={enrol.confirm} />
      </div>
    );
  }
  return (
    <Button asChild>
      <Link href="/">{t(locale, 'admin.goHome')}</Link>
    </Button>
  );
}
