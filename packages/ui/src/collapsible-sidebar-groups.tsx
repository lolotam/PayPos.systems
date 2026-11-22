'use client';

import { CollapsibleGroupLink } from './collapsible-sidebar-group-link.js';
import { visiblePages, type NavigationGroup } from './navigation-presentation.js';

type SidebarGroupsProps = {
  groups: readonly NavigationGroup[];
  title: string;
  rail: boolean;
  currentGroupId?: string | undefined;
  currentPageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
};

export function SidebarGroups({
  groups,
  title,
  rail,
  currentGroupId,
  currentPageId,
  visiblePageIds,
}: SidebarGroupsProps) {
  const shownGroups = groups
    .map((group) => ({ ...group, pages: visiblePages(group.pages, visiblePageIds) }))
    .filter((group) => group.pages.length > 0);
  const explicitCurrent = shownGroups.some((group) => group.id === currentGroupId);
  const activeGroupId = explicitCurrent
    ? currentGroupId
    : shownGroups.find((group) => group.pages.some((page) => page.id === currentPageId))?.id;
  return (
    <nav aria-label={title} className="flex-1 px-2 pb-4">
      <div className="flex flex-col gap-1">
        {shownGroups.map((group) => (
          <CollapsibleGroupLink
            key={group.id}
            group={group}
            rail={rail}
            active={group.id === activeGroupId}
          />
        ))}
      </div>
    </nav>
  );
}
