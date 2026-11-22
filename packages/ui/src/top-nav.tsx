'use client';

import { useMemo } from 'react';
import {
  moduleHasVisiblePages,
  visiblePages,
  type NavigationModule,
} from './navigation-presentation.js';
import { TopNavContent } from './top-nav-content.js';
import type { TopNavProps } from './top-nav-types.js';
import { useNavigationMedia } from './use-navigation-media.js';

export type { TopNavProps } from './top-nav-types.js';

function visibleNavigationKey(
  modules: readonly NavigationModule[],
  visiblePageIds?: readonly string[],
): string {
  return modules
    .map((module) => {
      const pageIds = module.sections
        .flatMap((section) => visiblePages(section.pages, visiblePageIds))
        .map((page) => page.id)
        .join('\u0001');
      return `${module.id}\u0002${pageIds}`;
    })
    .join('\u0000');
}

export function TopNav({ modules, visiblePageIds, ...chromeProps }: TopNavProps) {
  const isPhone = useNavigationMedia('(width < 700px)');
  const isCompact = useNavigationMedia('(width < 1024px)');
  const layout = isPhone ? 'phone' : isCompact ? 'tablet' : 'desktop';
  const visibleModules = useMemo(
    () => modules.filter((module) => moduleHasVisiblePages(module, visiblePageIds)),
    [modules, visiblePageIds],
  );
  const visibilityKey = useMemo(
    () => visibleNavigationKey(visibleModules, visiblePageIds),
    [visibleModules, visiblePageIds],
  );
  return (
    <TopNavContent
      layout={layout}
      visibilityKey={visibilityKey}
      visiblePageIds={visiblePageIds}
      visibleModules={visibleModules}
      {...chromeProps}
    />
  );
}
