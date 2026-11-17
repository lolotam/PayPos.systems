'use client';
import type {
  ServiceCategoryClosingAction,
  ServiceCategoryClosingFailureCode,
} from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { stopsPolling } from '../api/use-service-category-closing';
import { closingView, formatCount, type ClosingViewInput } from '../model/service-category-closing';

const CLOSING_ERROR_LABEL: Record<ServiceCategoryClosingFailureCode, MessageKey> = {
  SERVICE_CATEGORY_REVISION_CONFLICT: 'errors.SERVICE_CATEGORY_REVISION_CONFLICT',
  SERVICE_CATEGORY_ALREADY_CLOSED: 'errors.SERVICE_CATEGORY_ALREADY_CLOSED',
  SERVICE_CATEGORY_NOT_CLOSED: 'errors.SERVICE_CATEGORY_NOT_CLOSED',
  SERVICE_CATEGORY_COUNT_CHANGED: 'errors.SERVICE_CATEGORY_COUNT_CHANGED',
  SERVICE_CATEGORY_CLOSING_EXPIRED: 'errors.SERVICE_CATEGORY_CLOSING_EXPIRED',
  SERVICE_CATEGORY_CLOSING_FAILED: 'errors.SERVICE_CATEGORY_CLOSING_FAILED',
};

export type NoticeInput = ClosingViewInput;

export function ServiceCategoryClosingNotice({
  input,
  error,
  onRetry,
}: {
  input: NoticeInput;
  error?: unknown;
  onRetry: (action: ServiceCategoryClosingAction) => void;
}) {
  const locale = useLocale();
  if (stopsPolling(error)) return <p role="alert">{envelopeMessage(error, locale)}</p>;
  const view = closingView(input);
  if (view.tone === 'failed') {
    return (
      <div className="flex flex-col gap-3" role="alert">
        <p>{t(locale, CLOSING_ERROR_LABEL[view.errorCode])}</p>
        <Button variant="outline" onClick={() => onRetry(input.action)}>
          {t(locale, 'catalogServiceCategories.retry')}
        </Button>
      </div>
    );
  }
  return (
    <p role="status">
      {view.tone === 'done' ? formatCount(t(locale, view.key), view.count) : t(locale, view.key)}
    </p>
  );
}
