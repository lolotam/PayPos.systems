import { HubCard, PageHeader, PageShell, type HubCardItem } from '@pospay/ui';

export interface GroupOverviewData {
  label: string;
  description: string | undefined;
  sections: readonly { id: string; label: string; items: readonly HubCardItem[] }[];
}

/**
 * صفحة النظرة العامة لوحدة B أو مساحة C: صفحات كل قائمة فرعية كبطاقات محور.
 * البيانات تصل جاهزة من نموذج القائمة بعد إخفاء ما لا يراه المستخدم، فلا شرط ظهور هنا.
 */
export function GroupOverviewPage({ overview }: { overview: GroupOverviewData }) {
  return (
    <PageShell layout="list" className="flex flex-col gap-6">
      <PageHeader
        title={overview.label}
        {...(overview.description === undefined ? {} : { description: overview.description })}
      />
      {overview.sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`overview-${section.id}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`overview-${section.id}`} className="text-lg font-semibold">
            {section.label}
          </h2>
          <div className="grid gap-3 min-[768px]:grid-cols-2 min-[1024px]:grid-cols-3">
            {section.items.map((item) => (
              <HubCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}
