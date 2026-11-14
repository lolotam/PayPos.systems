'use client';
import type { ServiceCategoryDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { ServiceCategoryClosingRequest } from '../api/use-service-category-closing';
import { ServiceCategoryActions } from './service-category-actions';
import type { NoticeInput } from './service-category-closing-notice';
import { ServiceCategoryForm } from './service-category-form';

type ServiceCategoryRecordProps = {
  companyId: string;
  businessId: string;
  userId: string;
  record: ServiceCategoryDetail;
  noticeInput: NoticeInput | null;
  noticeError?: unknown;
  closingError?: unknown;
  closingPending: boolean;
  requestClosing: (input: ServiceCategoryClosingRequest, onAccepted?: () => void) => void;
  onRetry: (categoryId: string) => void;
  onRefresh: () => Promise<boolean>;
};

export function ServiceCategoryRecord(props: ServiceCategoryRecordProps) {
  const locale = useLocale();
  const { record } = props;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p>{locale === 'ar' ? record.name_ar : record.name_en}</p>
        <Badge variant={record.closed_at === null ? 'success' : 'neutral'}>
          {t(
            locale,
            record.closed_at === null
              ? 'catalogServiceCategories.open'
              : 'catalogServiceCategories.closed',
          )}
        </Badge>
      </div>
      <ServiceCategoryForm
        key={`${record.id}:${record.revision}`}
        companyId={props.companyId}
        businessId={props.businessId}
        userId={props.userId}
        mode="rename"
        record={record}
        onSaved={() => undefined}
        onReload={() => {
          void props.onRefresh();
        }}
      />
      <ServiceCategoryActions
        record={record}
        noticeInput={props.noticeInput}
        noticeError={props.noticeError}
        closingError={props.closingError}
        closingPending={props.closingPending}
        requestClosing={props.requestClosing}
        onRetry={props.onRetry}
        onRefresh={props.onRefresh}
      />
    </>
  );
}
