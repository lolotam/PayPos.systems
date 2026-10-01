'use client';

import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

import { displayName } from '../model/display-name';
import { useWorkspace } from '../model/workspace-provider';

function chosen(
  item: { name_ar: string | null; name_en: string } | undefined,
  locale: ReturnType<typeof useLocale>,
): string {
  return item ? displayName(item, locale) : t(locale, 'admin.notChosen');
}

export function HomePage() {
  const locale = useLocale();
  const workspace = useWorkspace();
  if (workspace.status !== 'ready') return null;
  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h1 className="text-start text-xl font-bold">{t(locale, 'admin.homeTitle')}</h1>
      <p className="flex flex-wrap gap-2 text-start">
        <span className="text-muted-foreground">{t(locale, 'admin.homeCompany')}</span>
        <span>{displayName(workspace.company, locale)}</span>
      </p>
      <p className="flex flex-wrap gap-2 text-start">
        <span className="text-muted-foreground">{t(locale, 'admin.homeBusiness')}</span>
        <span>{chosen(workspace.business, locale)}</span>
      </p>
      <p className="flex flex-wrap gap-2 text-start">
        <span className="text-muted-foreground">{t(locale, 'admin.homeBranch')}</span>
        <span>{chosen(workspace.branch, locale)}</span>
      </p>
    </section>
  );
}
