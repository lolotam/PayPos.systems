'use client';
import type { Service } from '@pospay/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { ServiceClosingInput } from '../api/use-service-closing';
import { ServiceClosingConfirm } from './service-closing-confirm';

type ServiceClosingMutation = UseMutationResult<Service, Error, ServiceClosingInput>;

type ServiceClosingToggleProps = {
  record: Service;
  closing: ServiceClosingMutation;
  formPending: boolean;
  dirty: boolean;
  onRequest: (input: ServiceClosingInput) => void;
};

// القفل بس اللي بيسأل مرة قبل التنفيذ، والفتح بيرجّع البيع فبيتنفذ على طول؛
// الزرار بيتعطل وقت تنفيذ الحفظ أو القفل، وفيه تعديلات متحفظاش لأن القفل بيغيّر النسخة وبيمسحها.
export function ServiceClosingToggle(props: ServiceClosingToggleProps) {
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const closed = props.record.closed_at !== null;
  // التأكيد بيسيب مكانه بعد النجاح؛ وفتح القفل من الأول بيمسح نتيجة الطلب اللي فات
  // عشان التأكيد يظهر تاني بعد قفل وفتح في نفس اللوحة، وما يفضلش سطر نتيجة قديم معلق.
  const confirmVisible = confirming && !closed && !props.closing.isSuccess;
  const request = () =>
    props.onRequest({
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
            disabled={props.formPending || props.dirty}
            onClick={() => {
              if (closed) {
                request();
                return;
              }
              props.closing.reset();
              setConfirming(true);
            }}
          >
            {t(locale, closed ? 'catalogServices.reopenService' : 'catalogServices.closeService')}
          </Button>
        )}
      </div>
      {confirmVisible ? (
        <ServiceClosingConfirm
          pending={props.formPending}
          dirty={props.dirty}
          onConfirm={request}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {props.dirty ? <p className="text-sm">{t(locale, 'catalogServices.editsUnsaved')}</p> : null}
    </div>
  );
}
