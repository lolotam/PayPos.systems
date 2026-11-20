'use client';
import type { PackageSaleStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Label } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { useSellPackage } from '../api/use-sell-package';

export function PackageSaleRecoveryNotice({
  mutation,
  status,
}: {
  mutation: ReturnType<typeof useSellPackage>;
  status: PackageSaleStatus['status'] | undefined;
}) {
  const locale = useLocale();
  const [verifiedKey, setVerifiedKey] = useState<string | null>(null);
  const acknowledged = verifiedKey !== null && verifiedKey === mutation.attemptKey;
  const settled = status === 'completed';
  return (
    <>
      {/* A confirmed terminal result means the attempt no longer depends on this device. */}
      {mutation.journalUnsaved && !settled ? (
        <p role="alert">{t(locale, 'packageSale.journalUnsaved')}</p>
      ) : null}
      {mutation.recoveryRequired ? (
        <p role="alert">
          {t(
            locale,
            mutation.verificationRequired
              ? 'packageSale.verificationRequired'
              : 'packageSale.recoverOriginal',
          )}
        </p>
      ) : null}
      {mutation.verificationRequired ? (
        <>
          <Label className="flex items-center gap-2 text-start">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) =>
                setVerifiedKey(event.target.checked ? mutation.attemptKey : null)
              }
            />
            {t(locale, 'packageSale.verifiedWithManager')}
          </Label>
          <Button
            type="button"
            variant="outline"
            disabled={!acknowledged}
            onClick={() => void mutation.discardExpired()}
          >
            {t(locale, 'packageSale.discardExpired')}
          </Button>
        </>
      ) : null}
      {mutation.isError ? <p role="alert">{envelopeMessage(mutation.error, locale)}</p> : null}
    </>
  );
}
