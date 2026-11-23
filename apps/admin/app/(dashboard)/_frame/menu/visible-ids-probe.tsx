import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

import { NAVIGATION_PAGES, pageEntryHref } from '../navigation-model';
import { useVisiblePageIds } from './use-visible-page-ids';

/** عنصر اختبار: يعرض الصفحات التي تراها القوائم الآن كروابط باسمها وعنوانها، بالقراءات الحقيقية خلف كل شرط ظهور. */
export function VisibleIdsProbe() {
  const locale = useLocale();
  const ids = useVisiblePageIds();
  return (
    <ul aria-label="Visible pages">
      {NAVIGATION_PAGES.filter((entry) => ids.includes(entry.id)).map((entry) => (
        <li key={entry.id}>
          <a href={pageEntryHref(entry)}>{t(locale, entry.labelKey)}</a>
        </li>
      ))}
    </ul>
  );
}
