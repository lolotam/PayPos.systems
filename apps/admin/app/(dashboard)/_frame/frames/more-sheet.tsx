import { shellNavLinkClass } from '@pospay/ui';

import type { ResolvedTopLevel } from '../menu/resolve-top-levels';

/**
 * ورقة «المزيد» على هاتف النمط A: بقية الأقسام وقوائمها الفرعية كروابط.
 * @pospay/ui لا تصدّر ورقة سفلية والمواصفة تمنع مكتبة جديدة، فهي منطقة عادية فوق الشريط السفلي.
 */
export function MoreSheet({
  groups,
  label,
  currentPageId,
}: {
  groups: readonly ResolvedTopLevel[];
  label: string;
  currentPageId: string | undefined;
}) {
  return (
    <section
      aria-label={label}
      className="max-h-[60dvh] overflow-y-auto border-t border-border bg-card px-4 py-3 min-[600px]:hidden"
    >
      {groups.map((group) => (
        <div key={group.id} className="mb-3">
          <h2 className="text-sm font-semibold">{group.label}</h2>
          {group.lists.map((list) => (
            <div key={list.id}>
              <h3 className="mt-2 text-xs text-muted-foreground">{list.label}</h3>
              <ul>
                {list.pages.map((page) => (
                  <li key={page.id}>
                    <a
                      href={page.href}
                      aria-current={page.id === currentPageId ? 'page' : undefined}
                      className={`${shellNavLinkClass} ${page.id === currentPageId ? 'font-semibold' : ''}`}
                    >
                      <span className="truncate">{page.label}</span>
                      {page.status ? (
                        <span className="text-xs text-muted-foreground">{page.status}</span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
