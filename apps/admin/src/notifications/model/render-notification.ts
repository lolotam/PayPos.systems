import type { InAppNotification } from '@pospay/contracts';
import { t } from '@pospay/i18n';

export function renderNotification(item: InAppNotification): string {
  return item.safe_parameters.reduce(
    (text, parameter) => text.replaceAll(`{{${parameter.name}}}`, () => parameter.value),
    t(item.locale, `inApp.${item.template_key}`),
  );
}
