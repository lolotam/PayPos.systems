'use client';

import {
  onSameTabActivation,
  visiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

export type LocalNavProps = {
  module: NavigationModule;
  labels: NavigationChromeLabels;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onNavigate?: (() => void) | undefined;
};

export function LocalNav({
  module,
  labels,
  activePageId,
  visiblePageIds,
  onNavigate,
}: LocalNavProps) {
  return (
    <nav
      aria-label={labels.localNavigation}
      className="hidden overflow-x-auto px-2 py-2 min-[700px]:block min-[1024px]:w-60 min-[1024px]:shrink-0 min-[1024px]:overflow-y-auto min-[1024px]:px-4"
    >
      <ul className="flex items-center gap-1 min-[1024px]:flex-col min-[1024px]:items-stretch">
        {module.sections.flatMap((section) =>
          visiblePages(section.pages, visiblePageIds).map((page) => (
            <li key={page.id} className="shrink-0">
              <a
                href={page.href}
                aria-current={page.id === activePageId ? 'page' : undefined}
                onClick={onSameTabActivation(onNavigate)}
                className={cn(
                  'flex min-h-11 min-w-11 items-center gap-2 whitespace-nowrap rounded-interactive px-3 py-2 text-sm',
                  page.id === activePageId
                    ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
                    : SIDEBAR_GHOST_CLASSES,
                )}
              >
                <span className="truncate">{page.label}</span>
                {page.status ? <span className="text-xs opacity-80">{page.status}</span> : null}
              </a>
            </li>
          )),
        )}
      </ul>
    </nav>
  );
}
