'use client';

import type { AlertRules } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useSetAlertsMaster } from '../api/use-set-alerts-master';
import { alertRulesFailureMessage } from '../model/alert-rules-failure';

export function AlertsMasterSwitch({
  companyId,
  userId,
  businessId,
  server,
}: {
  companyId: string;
  userId: string;
  businessId: string;
  server: AlertRules;
}) {
  const locale = useLocale();
  const mutation = useSetAlertsMaster(companyId, userId, businessId);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-4">
      <div className="flex items-center gap-3">
        <input
          id="alerts-master"
          type="checkbox"
          role="switch"
          checked={server.alerts_enabled}
          disabled={mutation.isPending}
          onChange={(event) => mutation.mutate(event.target.checked)}
        />
        <Label htmlFor="alerts-master">{t(locale, 'alertRules.masterLabel')}</Label>
      </div>
      {!server.alerts_enabled ? (
        <p role="status">{t(locale, 'alertRules.masterOffNote')}</p>
      ) : null}
      {mutation.isError ? (
        <p role="alert">{alertRulesFailureMessage(mutation.error, locale)}</p>
      ) : null}
    </div>
  );
}
