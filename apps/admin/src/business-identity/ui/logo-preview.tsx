'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useLogoDownload } from '../api/use-logo-download';
import { identityFailureMessage } from '../model/identity-failure';

export function LogoPreview({
  companyId,
  userId,
  fileId,
  alt,
}: {
  companyId: string;
  userId: string;
  fileId: string | null;
  alt: string;
}) {
  const locale = useLocale();
  const download = useLogoDownload(companyId, userId, fileId);
  if (!fileId) return null;
  if (download.failure) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert">{identityFailureMessage(download.failure, locale)}</p>
        {download.refused ? null : (
          <Button type="button" variant="outline" onClick={() => void download.retry()}>
            {t(locale, 'pos.retry')}
          </Button>
        )}
      </div>
    );
  }
  if (!download.url) return <p role="status">{t(locale, 'admin.loading')}</p>;
  return <img src={download.url} alt={alt} className="max-h-40 max-w-full" />;
}
