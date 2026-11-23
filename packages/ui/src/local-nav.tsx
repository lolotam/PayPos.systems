'use client';

import { useEffect, useRef } from 'react';
import { LocalNavLink } from './local-nav-link.js';
import { cn } from './shared/cn.js';
import {
  visiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';

export type LocalNavProps = {
  module: NavigationModule;
  labels: NavigationChromeLabels;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onNavigate?: (() => void) | undefined;
  /** يضيفه المستضيف إلى معلم التنقّل، كحدّ لارتفاع القائمة العمودية فتتمرر داخل نفسها بدل أن تطول الصفحة. */
  className?: string | undefined;
};

// أقرب إزاحة تُظهر العنصر داخل الحاوية: صفر إن كان ظاهرًا أصلًا. الفرق بين إحداثيات العرض لا يتأثر بالاتجاه.
function nearestOffset(start: number, end: number, boxStart: number, boxEnd: number): number {
  if (start < boxStart) return start - boxStart;
  return end > boxEnd ? end - boxEnd : 0;
}

// scrollIntoView يحرّك كل سلف قابل للتمرير ومنه الصفحة نفسها، فنحرّك القائمة وحدها.
function revealInside(nav: HTMLElement, item: Element): void {
  const area = nav.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  nav.scrollTop += nearestOffset(rect.top, rect.bottom, area.top, area.bottom);
  nav.scrollLeft += nearestOffset(rect.left, rect.right, area.left, area.right);
}

/**
 * القائمة المحلية للوحدة الحالية: شريط أفقي مسطّح بين 700 و1023px، وقائمة عمودية من 1024px
 * تجمع الصفحات تحت عنوان كل قسم (app-map.md). العنوان مخفي في الشريط الأفقي.
 * الصفحة الحالية تُظهَر داخل القائمة نفسها عند تغيّرها أو عند ظهورها متأخرة بعد وصول الصلاحيات،
 * ولا تتحرك الصفحة المحيطة بسبب ذلك.
 */
export function LocalNav({
  module,
  labels,
  activePageId,
  visiblePageIds,
  onNavigate,
  className,
}: LocalNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const sections = module.sections
    .map((section) => ({ section, pages: visiblePages(section.pages, visiblePageIds) }))
    .filter(({ pages }) => pages.length > 0);
  const visibleKey = sections.flatMap(({ pages }) => pages.map((page) => page.id)).join('\u0000');
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector('[aria-current="page"]');
    if (nav && current) revealInside(nav, current);
  }, [activePageId, visibleKey]);
  return (
    <nav
      ref={navRef}
      aria-label={labels.localNavigation}
      className={cn(
        'hidden overflow-x-auto px-2 py-2 min-[700px]:block min-[1024px]:w-60 min-[1024px]:shrink-0 min-[1024px]:overflow-y-auto min-[1024px]:px-4',
        className,
      )}
    >
      <ul className="flex items-center gap-1 min-[1024px]:flex-col min-[1024px]:items-stretch">
        {sections.flatMap(({ section, pages }) => [
          <li key={`${section.id}-heading`} className="hidden min-[1024px]:block">
            <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-sidebar-foreground/70">
              {section.label}
            </h3>
          </li>,
          ...pages.map((page) => (
            <LocalNavLink
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
