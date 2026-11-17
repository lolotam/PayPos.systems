'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function ServiceCategoryFormFeedback({
  mode,
  error,
  success,
  onReload,
}: {
  mode: 'create' | 'rename';
  error?: unknown;
  success: boolean;
  onReload: () => void;
}) {
  const locale = useLocale();
  return (
    <>
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
      {hasCode(error, 'SERVICE_CATEGORY_REVISION_CONFLICT') ? (
        <Button type="button" variant="outline" onClick={onReload}>
          {t(locale, 'catalogServiceCategories.reload')}
        </Button>
      ) : null}
      {success ? (
        <p role="status">
          {t(
            locale,
            mode === 'create'
              ? 'catalogServiceCategories.created'
              : 'catalogServiceCategories.saved',
          )}
        </p>
      ) : null}
    </>
  );
}
