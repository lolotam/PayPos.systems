'use client';

import { useEffect, useRef } from 'react';
import {
  onSameTabActivation,
  visiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
  type NavigationPage,
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

function PageLink({
  page,
  active,
  onNavigate,
}: {
  page: NavigationPage;
  active: boolean;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <li className="shrink-0">
      <a
        href={page.href}
        aria-current={active ? 'page' : undefined}
        onClick={onSameTabActivation(onNavigate)}
        className={cn(
          'flex min-h-11 min-w-11 items-center gap-2 whitespace-nowrap rounded-interactive px-3 py-2 text-sm',
          active
            ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
            : SIDEBAR_GHOST_CLASSES,
        )}
      >
        <span className="truncate">{page.label}</span>
        {page.status ? <span className="text-xs opacity-80">{page.status}</span> : null}
      </a>
    </li>
  );
}

/**
 * القائمة المحلية للوحدة الحالية: شريط أفقي مسطّح بين 700 و1023px، وقائمة عمودية من 1024px
 * تجمع الصفحات تحت عنوان كل قسم (app-map.md). العنوان مخفي في الشريط الأفقي.
 * الصفحة الحالية تُحرَّك إلى الشاشة عند تغيّرها أو عند ظهورها متأخرة بعد وصول الصلاحيات.
 */
export function LocalNav({
  module,
  labels,
  activePageId,
  visiblePageIds,
  onNavigate,
}: LocalNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const sections = module.sections
    .map((section) => ({ section, pages: visiblePages(section.pages, visiblePageIds) }))
    .filter(({ pages }) => pages.length > 0);
  const visibleKey = sections.flatMap(({ pages }) => pages.map((page) => page.id)).join('\u0000');
  useEffect(() => {
    const current = navRef.current?.querySelector('[aria-current="page"]');
    if (typeof current?.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activePageId, visibleKey]);
  return (
    <nav
      ref={navRef}
      aria-label={labels.localNavigation}
      className="hidden overflow-x-auto px-2 py-2 min-[700px]:block min-[1024px]:w-60 min-[1024px]:shrink-0 min-[1024px]:overflow-y-auto min-[1024px]:px-4"
    >
      <ul className="flex items-center gap-1 min-[1024px]:flex-col min-[1024px]:items-stretch">
        {sections.flatMap(({ section, pages }) => [
          <li key={`${section.id}-heading`} className="hidden min-[1024px]:block">
            <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-sidebar-foreground/70">
              {section.label}
            </h3>
          </li>,
          ...pages.map((page) => (
            <PageLink
              key={page.id}
              page={page}
              active={page.id === activePageId}
              onNavigate={onNavigate}
            />
          )),
        ])}
      </ul>
    </nav>
  );
}
