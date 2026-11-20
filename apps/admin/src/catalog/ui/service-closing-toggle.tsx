'use client';
import type { Service } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useServiceClosing } from '../api/use-service-closing';
import { ServiceClosingConfirm } from './service-closing-confirm';

type ServiceClosingToggleProps = {
  companyId: string;
  businessId: string;
  userId: string;
  serviceId: string;
  record: Service;
  savePending: boolean;
};

// القفل بس اللي بيسأل مرة قبل التنفيذ، والفتح بيرجّع البيع فبيتنفذ على طول؛
// الزرار بيتعطل وقت حفظ نموذج التعديل أو تنفيذ القفل نفسه.
export function ServiceClosingToggle(props: ServiceClosingToggleProps) {
  const locale = useLocale();
  const closing = useServiceClosing(
    props.companyId,
    props.businessId,
    props.userId,
    props.serviceId,
  );
  const [confirming, setConfirming] = useState(false);
  const closed = props.record.closed_at !== null;
  // التأكيد بيسيب مكانه بعد النجاح، لأن الشارة بتبين الحالة الجديدة ورسالة النتيجة ظاهرة.
  const confirmVisible = confirming && !closed && !closing.isSuccess;
  const request = () =>
    closing.mutate({
      action: closed ? 'reopen' : 'close',
      expectedRevision: props.record.revision,
    });
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Badge variant="neutral">
          {t(locale, closed ? 'catalogServiceCategories.closed' : 'catalogServiceCategories.open')}
        </Badge>
        {confirmVisible ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={props.savePending || closing.isPending}
            onClick={() => (closed ? request() : setConfirming(true))}
          >
            {t(locale, closed ? 'catalogServices.reopenService' : 'catalogServices.closeService')}
          </Button>
        )}
      </div>
      {confirmVisible ? (
        <ServiceClosingConfirm
          pending={closing.isPending}
          onConfirm={request}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {closing.isError ? <p role="alert">{envelopeMessage(closing.error, locale)}</p> : null}
      {closing.isSuccess && closing.data ? (
        <p role="status">
          {t(
            locale,
            closing.data.closed_at
              ? 'catalogServices.serviceClosed'
              : 'catalogServices.serviceReopened',
          )}
        </p>
      ) : null}
    </div>
  );
}
