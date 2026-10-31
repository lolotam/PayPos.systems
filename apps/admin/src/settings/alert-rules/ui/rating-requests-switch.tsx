'use client';

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
  // المفتاح ده مستقل عن مفتاح التنبيهات: عميل ما عندوش صلاحيته ما يشوفش الكارت خالص.
  if (query.isError && isAlertRulesRefusal(query.error)) return null;
  if (query.isPending) return null;
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
      {query.isError ? (
        <p role="alert">{alertRulesFailureMessage(query.error, locale)}</p>
      ) : null}
      {mutation.isError ? (
        <p role="alert">{alertRulesFailureMessage(mutation.error, locale)}</p>
      ) : null}
    </div>
  );
}
