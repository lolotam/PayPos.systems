'use client';
import type { ServiceCategoryClosingAction } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';
import { useEffect, type RefObject } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { ServiceCategoryClosingRequest } from '../api/use-service-category-closing';
import { useServiceCategoryDetail } from '../api/use-service-category-detail';
import type { TrackedServiceCategoryClosing } from '../model/service-category-closing';
import type { NoticeInput } from './service-category-closing-notice';
import { ServiceCategoryRecord } from './service-category-record';

type ServiceCategoryPanelProps = {
  companyId: string;
  businessId: string;
  userId: string;
  categoryId: string;
  tracked: TrackedServiceCategoryClosing | null;
  finished: RefObject<Set<string>>;
  noticeInput: NoticeInput | null;
  noticeError?: unknown;
  closingError?: unknown;
  closingPending: boolean;
  requestClosing: (input: ServiceCategoryClosingRequest, onAccepted?: () => void) => void;
  onTrack: (categoryId: string, closingId: string, action: ServiceCategoryClosingAction) => void;
  onRetry: (categoryId: string) => void;
  onClose: () => void;
};

export function ServiceCategoryPanel(props: ServiceCategoryPanelProps) {
  const locale = useLocale();
  const detail = useServiceCategoryDetail(
    props.companyId,
    props.businessId,
    props.userId,
    props.categoryId,
  );
  const record = detail.data;
  const { tracked, finished, onTrack } = props;
  useEffect(() => {
    const id = record?.pending_closing_id;
    if (!id || tracked?.categoryId === record.id || finished.current.has(id)) return;
    onTrack(record.id, id, record.closed_at === null ? 'close' : 'reopen');
  }, [finished, onTrack, record, tracked]);
  const refresh = async () => {
    const refetchResult = await detail.refetch();
    return (
      refetchResult.status === 'success' && !refetchResult.error && Boolean(refetchResult.data)
    );
  };
  return (
    <Card className="flex max-w-xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{t(locale, 'catalogServiceCategories.detailTitle')}</h2>
        <Button variant="ghost" onClick={props.onClose}>
          {t(locale, 'catalogServiceCategories.cancel')}
        </Button>
      </div>
      {detail.isPending ? (
        <EmptyState icon={<LoaderCircle />} role="status" title={t(locale, 'admin.loading')} />
      ) : null}
      {detail.isError ? (
        <EmptyState
          icon={<CircleAlert />}
          role="alert"
          tone="danger"
          title={envelopeMessage(detail.error, locale)}
        />
      ) : null}
      {record && !detail.isError ? (
        <ServiceCategoryRecord
          companyId={props.companyId}
          businessId={props.businessId}
          userId={props.userId}
          record={record}
          noticeInput={props.noticeInput}
          noticeError={props.noticeError}
          closingError={props.closingError}
          closingPending={props.closingPending}
          requestClosing={props.requestClosing}
          onRetry={props.onRetry}
          onRefresh={refresh}
        />
      ) : null}
    </Card>
  );
}
