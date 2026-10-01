import type { InAppNotification } from '@pospay/contracts';
import { t } from '@pospay/i18n';

export function renderNotification(item: InAppNotification): string {
  return t(item.locale, `inApp.${item.template_key}`).replace(
    '{{subject}}',
    () => item.safe_parameters[0].value,
  );
}
