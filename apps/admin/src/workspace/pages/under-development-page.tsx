'use client';

import { t } from '@pospay/i18n';
import { Button, PageHeader, PageShell } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/**
 * الصفحة المشتركة لكل مدخل لم يُبنَ بعد: اسم المدخل وسطر واحد وطريق للرئيسية، بلا تاريخ ولا رقم مرحلة (FR-021).
 * الاسم يصل مترجمًا من المستضيف الذي حلّ المعرّف، فالصفحة لا تقرأ نموذج التنقّل.
 */
export function UnderDevelopmentPage({ name, homeHref }: { name: string; homeHref: string }) {
  const locale = useLocale();
  return (
    <PageShell layout="form" className="flex flex-col gap-6">
      <PageHeader title={name} description={t(locale, 'adminNav.underDevBody')} />
      <p className="text-sm font-semibold">{t(locale, 'adminNav.underDevHeading')}</p>
      <div>
        <Button variant="outline" asChild>
          <a href={homeHref}>{t(locale, 'adminNav.underDevBackHome')}</a>
        </Button>
      </div>
    </PageShell>
  );
}
