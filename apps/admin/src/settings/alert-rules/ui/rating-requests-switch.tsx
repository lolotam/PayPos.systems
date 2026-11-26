'use client';

import { useEffect } from 'react';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useRatingSettings } from '../api/use-rating-settings';
import { useSetRatingRequests } from '../api/use-set-rating-requests';
import { alertRulesFailureMessage, isAlertRulesRefusal } from '../model/alert-rules-failure';

export function RatingRequestsSwitch({
  companyId,
  userId,
  businessId,
}: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const query = useRatingSettings(companyId, userId, businessId);
  const mutation = useSetRatingRequests(companyId, userId, businessId);
  const storedEnabled = query.isSuccess ? (query.data?.requests_enabled ?? false) : undefined;
  // الكتابة ممكن تتحفظ في السيرفر والرد هو اللي يضيع؛ فلو القيمة المخزّنة بعد إعادة القراءة بقت
  // هي اللي حاولنا نكتبها، يبقى الـ PUT وصل والخطأ ده قديم، فبنخفيه وبنمسحه من المسار.
  const writeLanded =
    mutation.isError && mutation.variables !== undefined && storedEnabled === mutation.variables;
  const { reset } = mutation;
  // المسح بعد التأكد بس: كده لو حد غيّر القيمة في السيرفر بعد كده مفيش خطأ قديم يرجع يظهر تاني.
  useEffect(() => {
    if (writeLanded) reset();
  }, [writeLanded, reset]);
  // المفتاح ده مستقل عن مفتاح التنبيهات: عميل ما عندوش صلاحيته ما يشوفش الكارت خالص.
  if (query.isError && isAlertRulesRefusal(query.error)) return null;
  if (query.isPending) return null;
  // فشل القراءة مش معناه إن الطلبات مقفولة، فبنعرض الرسالة بس من غير مفتاح ومن غير ملاحظة المقفول.
  if (query.isError) {
    return <p role="alert">{alertRulesFailureMessage(query.error, locale)}</p>;
  }
  const enabled = query.data?.requests_enabled ?? false;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-4">
      <div className="flex items-center gap-3">
        <input
          id="rating-requests"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={mutation.isPending}
          onChange={(event) => mutation.mutate(event.target.checked)}
        />
        <Label htmlFor="rating-requests">{t(locale, 'alertRules.ratingRequestsLabel')}</Label>
      </div>
      {!enabled ? <p role="status">{t(locale, 'alertRules.ratingRequestsOffNote')}</p> : null}
      {mutation.isError && !writeLanded ? (
        <p role="alert">{alertRulesFailureMessage(mutation.error, locale)}</p>
      ) : null}
    </div>
  );
}
