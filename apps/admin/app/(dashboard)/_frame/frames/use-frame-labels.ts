'use client';

import { t } from '@pospay/i18n';
import type {
  AccountMenuLabels,
  ContextPanelLabels,
  NavigationChromeLabels,
  NavigationFinderLabels,
  WorkspaceSwitcherLabels,
} from '@pospay/ui';
import { useMemo } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

export interface FrameLabels {
  chrome: NavigationChromeLabels;
  panel: ContextPanelLabels;
  finder: NavigationFinderLabels;
  switcher: WorkspaceSwitcherLabels;
  account: AccountMenuLabels;
  tabs: { label: string };
  pills: { label: string };
  bottom: { label: string };
  workspaceTabs: { label: string };
  more: string;
}

/** كل نصوص أجزاء @pospay/ui للإطارات الثلاثة، مترجمة من الفهرس ومحسوبة مرة لكل لغة. */
export function useFrameLabels(): FrameLabels {
  const locale = useLocale();
  return useMemo(() => {
    const label = (key: Parameters<typeof t>[1]) => t(locale, key);
    return {
      chrome: {
        navigation: label('shell.navigation'),
        openMenu: label('shell.openNavigation'),
        close: label('shell.closeNavigation'),
        overview: label('adminNav.overview'),
        localNavigation: label('adminNav.localNavigation'),
        expand: label('adminNav.expandNavigation'),
        collapse: label('adminNav.collapseNavigation'),
        drawerOpen: label('shell.openNavigation'),
        drawerTitle: label('adminNav.drawerTitle'),
        inspect: label('adminNav.inspectWorkspace'),
        hidePanel: label('adminNav.hidePanel'),
        current: label('adminNav.currentStyleBadge'),
      },
      panel: {
        navigation: label('adminNav.localNavigation'),
        close: label('adminNav.hidePanel'),
        empty: label('adminNav.pageFinderEmpty'),
        filterPages: label('adminNav.filterPages'),
      },
      finder: {
        trigger: label('adminNav.pageFinderLabel'),
        title: label('adminNav.pageFinderLabel'),
        search: label('adminNav.pageFinderPlaceholder'),
        close: label('shell.closeNavigation'),
        empty: label('adminNav.pageFinderEmpty'),
        current: label('adminNav.currentStyleBadge'),
      },
      switcher: {
        switcher: label('adminNav.workspacesLabel'),
        company: label('admin.companyLabel'),
        business: label('admin.businessLabel'),
        branch: label('admin.branchLabel'),
      },
      account: { label: label('adminNav.accountMenuLabel') },
      tabs: { label: label('adminNav.tabsLabel') },
      pills: { label: label('adminNav.pillsLabel') },
      bottom: { label: label('adminNav.bottomNavLabel') },
      workspaceTabs: { label: label('adminNav.workspacesLabel') },
      more: label('adminNav.more'),
    };
  }, [locale]);
}
