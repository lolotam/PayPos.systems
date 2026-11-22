'use client';

import { visiblePages, type NavigationSection } from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

type MegaMenuSectionProps = {
  section: NavigationSection;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onSelect: () => void;
};

export function MegaMenuSection({
  section,
  activePageId,
  visiblePageIds,
  onSelect,
}: MegaMenuSectionProps) {
  const pages = visiblePages(section.pages, visiblePageIds);
  if (pages.length === 0) return null;
  return (
    <section aria-label={section.label} className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{section.label}</h3>
      <ul className="flex flex-col gap-1">
        {pages.map((page) => (
          <li key={page.id}>
            <a
              href={page.href}
              aria-current={page.id === activePageId ? 'page' : undefined}
              onClick={onSelect}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-interactive px-3 py-2 text-sm',
                page.id === activePageId
                  ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
                  : SIDEBAR_GHOST_CLASSES,
              )}
            >
              <span className="truncate">{page.label}</span>
              {page.status ? <span className="shrink-0 text-xs opacity-80">{page.status}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
