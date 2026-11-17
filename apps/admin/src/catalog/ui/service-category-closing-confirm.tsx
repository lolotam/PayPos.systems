'use client';
import type { ServiceCategoryClosingAction, ServiceCategoryDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { ServiceCategoryClosingRequest } from '../api/use-service-category-closing';
import { formatCount } from '../model/service-category-closing';

export function ServiceCategoryClosingConfirm({
  detail,
  action,
  pending,
  error,
  requestClosing,
  onCancel,
}: {
  detail: ServiceCategoryDetail;
  action: ServiceCategoryClosingAction;
  pending: boolean;
  error?: unknown;
  requestClosing: (input: ServiceCategoryClosingRequest, onAccepted?: () => void) => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const count = action === 'close' ? detail.open_service_count : detail.marked_service_count;
  const confirm = () =>
    requestClosing(
      {
        categoryId: detail.id,
        action,
        expected_revision: detail.revision,
        expected_service_count: count,
      },
      onCancel,
    );
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p>
        {formatCount(
          t(
            locale,
            action === 'close'
              ? 'catalogServiceCategories.confirmClose'
              : 'catalogServiceCategories.confirmReopen',
          ),
          count,
        )}
      </p>
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
      <div className="flex gap-2">
        <Button disabled={pending} onClick={confirm}>
          {t(locale, 'catalogServiceCategories.confirm')}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          {t(locale, 'catalogServiceCategories.cancel')}
        </Button>
      </div>
    </div>
  );
}
