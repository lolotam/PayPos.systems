'use client';
import type { ServiceCategoryClosingAction, ServiceCategoryDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { ServiceCategoryClosingRequest } from '../api/use-service-category-closing';
import { ServiceCategoryClosingConfirm } from './service-category-closing-confirm';
import { ServiceCategoryClosingNotice, type NoticeInput } from './service-category-closing-notice';

type ServiceCategoryActionsProps = {
  record: ServiceCategoryDetail;
  noticeInput: NoticeInput | null;
  noticeError?: unknown;
  closingError?: unknown;
  closingPending: boolean;
  requestClosing: (input: ServiceCategoryClosingRequest, onAccepted?: () => void) => void;
  onRetry: (categoryId: string) => void;
  onRefresh: () => Promise<boolean>;
};

export function ServiceCategoryActions({
  record,
  noticeInput,
  noticeError,
  closingError,
  closingPending,
  requestClosing,
  onRetry,
  onRefresh,
}: ServiceCategoryActionsProps) {
  const locale = useLocale();
  const [confirmation, setConfirmation] = useState<ServiceCategoryClosingAction | null>(null);
  const retry = async (action: ServiceCategoryClosingAction) => {
    if (await onRefresh()) {
      onRetry(record.id);
      setConfirmation(action);
    }
  };
  return (
    <>
      {noticeInput ? (
        <ServiceCategoryClosingNotice
          input={noticeInput}
          error={noticeError}
          onRetry={(action) => {
            void retry(action);
          }}
        />
      ) : null}
      {confirmation ? (
        <ServiceCategoryClosingConfirm
          detail={record}
          action={confirmation}
          pending={closingPending}
          error={closingError}
          requestClosing={requestClosing}
          onCancel={() => setConfirmation(null)}
        />
      ) : (
        <Button
          variant="outline"
          onClick={() => setConfirmation(record.closed_at === null ? 'close' : 'reopen')}
        >
          {t(
            locale,
            record.closed_at === null
              ? 'catalogServiceCategories.closeCategory'
              : 'catalogServiceCategories.reopenCategory',
          )}
        </Button>
      )}
    </>
  );
}
