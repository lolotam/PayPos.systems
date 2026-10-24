'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export type AlertRulesNotice = 'saved' | 'nothing' | 'reset' | null;

export function AlertRulesFormStatus({
  invalid,
  failure,
  saving,
  notice,
}: {
  invalid: boolean;
  failure: string | null;
  saving: boolean;
  notice: AlertRulesNotice;
}) {
  const locale = useLocale();
  const key = notice === 'nothing' ? 'nothingChanged' : notice === 'reset' ? 'resetDone' : 'saved';
  return (
    <>
      {invalid ? <p role="alert">{t(locale, 'errors.ALERT_RULE_INVALID')}</p> : null}
      {failure ? <p role="alert">{failure}</p> : null}
      {saving ? <p role="status">{t(locale, 'alertRules.saving')}</p> : null}
      {notice ? <p role="status">{t(locale, `alertRules.${key}`)}</p> : null}
    </>
  );
}
