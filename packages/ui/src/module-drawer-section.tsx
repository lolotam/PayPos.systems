'use client';

import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react/dist/ssr';
import {
  visiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

const currentMarker = (
  <span
    aria-hidden="true"
    data-current-marker=""
    className="size-1.5 shrink-0 rounded-full bg-current"
  />
);

export type ModuleDrawerSectionProps = {
  module: NavigationModule;
  labels: NavigationChromeLabels;
  expanded: boolean;
  current: boolean;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onToggle: () => void;
  onSelect: () => void;
};

export function ModuleDrawerSection({
  module,
  labels,
  expanded,
  current,
  activePageId,
  visiblePageIds,
  onToggle,
  onSelect,
}: ModuleDrawerSectionProps) {
  const pages = module.sections.flatMap((section) =>
    visiblePages(section.pages, visiblePageIds),
  );
  if (pages.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        aria-expanded={expanded}
        aria-current={current ? 'page' : undefined}
        onClick={onToggle}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-interactive ps-3 pe-2 py-2 text-start text-sm font-medium',
          SIDEBAR_GHOST_CLASSES,
        )}
      >
        <span className="truncate">{module.label}</span>
        {current ? currentMarker : null}
        {current ? <span className="sr-only">{labels.current}</span> : null}
        {expanded ? (
          <CaretDownIcon aria-hidden="true" className="ms-auto size-4" />
        ) : (
          <CaretRightIcon aria-hidden="true" className="ms-auto size-4 rtl:rotate-180" />
        )}
      </button>
      {expanded ? (
        <ul className="mb-2 ps-4">
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
                {page.status ? <span className="text-xs opacity-80">{page.status}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
