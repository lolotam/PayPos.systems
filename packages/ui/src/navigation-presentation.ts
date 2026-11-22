import type { ReactNode } from 'react';

export type NavigationPage = {
  id: string;
  label: string;
  href: string;
  count?: string;
  status?: string;
};

export type NavigationSection = {
  id: string;
  label: string;
  pages: readonly NavigationPage[];
};

export type NavigationGroup = {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  count?: string;
  pages: readonly NavigationPage[];
};

export type NavigationModule = {
  id: string;
  label: string;
  href: string;
  sections: readonly NavigationSection[];
};

export type NavigationWorkspace = {
  id: string;
  label: string;
  icon?: ReactNode;
  sections: readonly NavigationSection[];
};

export type FinderResult = {
  page: NavigationPage;
  section: NavigationSection;
  workspace: NavigationWorkspace;
};

export type NavigationChromeLabels = {
  navigation: string;
  openMenu: string;
  close: string;
  overview: string;
  localNavigation: string;
  expand: string;
  collapse: string;
  drawerOpen: string;
  drawerTitle: string;
  inspect: string;
  hidePanel: string;
  current: string;
};

export type ContextPanelLabels = Pick<NavigationChromeLabels, 'navigation' | 'close'> & {
  empty: string;
  filterPages: string;
};

export type NavigationFinderLabels = {
  trigger: string;
  title: string;
  search: string;
  close: string;
  empty: string;
  current: string;
};

export function visiblePages(
  pages: readonly NavigationPage[],
  visiblePageIds?: readonly string[],
): NavigationPage[] {
  return visiblePageIds ? pages.filter((page) => visiblePageIds.includes(page.id)) : [...pages];
}

export function moduleHasVisiblePages(
  module: NavigationModule,
  visiblePageIds?: readonly string[],
): boolean {
  return module.sections.some((section) => visiblePages(section.pages, visiblePageIds).length > 0);
}

export function groupIsCurrent(
  group: NavigationGroup,
  currentGroupId?: string,
  currentPageId?: string,
): boolean {
  return (
    group.id === currentGroupId || group.pages.some((page) => page.id === currentPageId)
  );
}

export function resolveInspectedWorkspaceId({
  currentWorkspaceId,
  inspectedWorkspaceId,
  panelOpen,
}: {
  currentWorkspaceId?: string | undefined;
  inspectedWorkspaceId?: string | undefined;
  panelOpen: boolean;
}): string | undefined {
  return panelOpen ? (inspectedWorkspaceId ?? currentWorkspaceId) : undefined;
}

export function matchesPageQuery(label: string, query: string): boolean {
  return label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function visiblePagesMatchingQuery(
  pages: readonly NavigationPage[],
  visiblePageIds: readonly string[] | undefined,
  query: string,
): NavigationPage[] {
  return visiblePages(pages, visiblePageIds).filter((page) =>
    matchesPageQuery(page.label, query),
  );
}

export function collectFinderResults(
  workspaces: readonly NavigationWorkspace[],
  visiblePageIds: readonly string[] | undefined,
  query: string,
): FinderResult[] {
  const results: FinderResult[] = [];
  for (const workspace of workspaces) {
    for (const section of workspace.sections) {
      for (const page of visiblePages(section.pages, visiblePageIds)) {
        if (matchesPageQuery(page.label, query)) {
          results.push({ page, section, workspace });
        }
      }
    }
  }
  return results;
}
