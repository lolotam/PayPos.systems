'use client';

import { t } from '@pospay/i18n';
import { useEffect, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { issueLogoDownload } from '../api/identity-client';
import { identityFailureMessage } from '../model/identity-failure';

export function LogoPreview({
  companyId,
  fileId,
  alt,
}: {
  companyId: string;
  fileId: string | null;
  alt: string;
}) {
  const locale = useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    if (!fileId) return undefined;
    let cancelled = false;
    void issueLogoDownload(companyId, fileId).then(
      (download) => {
        if (!cancelled) setUrl(download.download_url);
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [companyId, fileId]);
  if (!fileId) return null;
  if (failure) return <p role="alert">{identityFailureMessage(failure, locale)}</p>;
  if (!url) return <p role="status">{t(locale, 'admin.loading')}</p>;
  return <img src={url} alt={alt} className="max-h-40 max-w-full" />;
}
