'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
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
  const [imageError, setImageError] = useState(false);
  const [holding, setHolding] = useState(false);
  const retryLabel = t(locale, 'pos.retry');
  if (!fileId) return null;
  if (download.failure) {
    return alertBlock(
      identityFailureMessage(download.failure, locale),
      download.refused ? null : () => void download.retry(),
      retryLabel,
    );
  }
  // فشل الصورة ما لهوش ظرف من الخادم، فرسالة الخطأ العامة هي النص بالعربي والإنجليزي
  if (imageError) {
    return alertBlock(
      t(locale, 'admin.unexpected'),
      () => {
        setImageError(false);
        setHolding(true);
        void download.retry().finally(() => setHolding(false));
      },
      retryLabel,
    );
  }
  if (!download.url || holding) return <p role="status">{t(locale, 'admin.loading')}</p>;
  return (
    <img
      src={download.url}
      alt={alt}
      className="max-h-40 max-w-full"
      onError={() => setImageError(true)}
    />
  );
}

function alertBlock(message: string, onRetry: (() => void) | null, retryLabel: string) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert">{message}</p>
      {onRetry === null ? null : (
        <Button type="button" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
