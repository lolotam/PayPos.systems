'use client';

import { t } from '@pospay/i18n';
import { Building2, Store, MapPin, PageHeader, Stat } from '@pospay/ui';

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
    <section className="flex flex-col gap-12">
      <PageHeader
        title={t(locale, 'admin.homeTitle')}
        description={t(locale, 'shell.workspaceLead')}
      />
      <div className="grid gap-2 md:grid-cols-3">
        <Stat
          label={t(locale, 'admin.homeCompany')}
          value={displayName(workspace.company, locale)}
          icon={<Building2 className="size-5" />}
        />
        <Stat
          label={t(locale, 'admin.homeBusiness')}
          value={chosen(workspace.business, locale)}
          icon={<Store className="size-5" />}
        />
        <Stat
          label={t(locale, 'admin.homeBranch')}
          value={chosen(workspace.branch, locale)}
          icon={<MapPin className="size-5" />}
        />
      </div>
    </section>
  );
}
