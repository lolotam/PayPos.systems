import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

/** شرح قصير للآيفون: من غير إضافة التطبيق للشاشة الرئيسية مفيش إشعارات (WP-Q3). */
export function PushInstallHint() {
  const locale = useLocale();
  return (
    <div className="grid gap-2">
      <p>{t(locale, 'staffPush.installLead')}</p>
      <ol className="grid gap-1">
        <li>{t(locale, 'staffPush.installStep1')}</li>
        <li>{t(locale, 'staffPush.installStep2')}</li>
        <li>{t(locale, 'staffPush.installStep3')}</li>
      </ol>
    </div>
  );
}
