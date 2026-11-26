import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

import { webAppUrl } from './native-shell';

/**
 * سطر FR-007: القدرة دي مش موجودة في نسخة التطبيق الأصلي، والموظفة بتتعملها من نسخة الويب.
 *
 * السطر بيقول الكلام الصريح وبيديها لينك يفتح نسخة الويب في المتصفح، عشان الشاشة ما تقفش
 * عند غير قادر.
 *
 * @param props.path المسار جوه نسخة الويب اللي هيتفتح
 */
export function WebOnlyNotice({ path = '/personal' }: { path?: string }) {
  const locale = useLocale();
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground">{t(locale, 'nativeShell.webOnlyNotice')}</p>
      <a
        className="font-medium underline"
        href={webAppUrl(path)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t(locale, 'nativeShell.openWebApp')}
      </a>
    </div>
  );
}
