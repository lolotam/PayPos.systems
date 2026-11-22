'use client';

import { useDirection } from './direction-provider.js';
import { RailWorkspaceButton } from './nav-rail-workspace-button.js';
import {
  moduleHasVisiblePages,
  resolveInspectedWorkspaceId,
  type NavigationChromeLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';

export type NavRailProps = {
  workspaces: readonly NavigationWorkspace[];
  labels: NavigationChromeLabels;
  currentWorkspaceId?: string | undefined;
  inspectedWorkspaceId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  panelOpen: boolean;
  onInspect: (workspaceId: string, opener: HTMLButtonElement) => void;
};

export function NavRail({
  workspaces,
  labels,
  currentWorkspaceId,
  inspectedWorkspaceId,
  visiblePageIds,
  panelOpen,
  onInspect,
}: NavRailProps) {
  const dir = useDirection();
  const inspectedId = resolveInspectedWorkspaceId({
    currentWorkspaceId,
    inspectedWorkspaceId,
    panelOpen,
  });
  return (
    <nav
      dir={dir}
      aria-label={labels.navigation}
      className="flex w-21 shrink-0 flex-col items-center gap-1 bg-sidebar p-2"
    >
      {workspaces
        .filter((workspace) => moduleHasVisiblePages(workspace, visiblePageIds))
        .map((workspace) => (
        <RailWorkspaceButton
          key={workspace.id}
          workspace={workspace}
          labels={labels}
          isCurrent={workspace.id === currentWorkspaceId}
          inspected={workspace.id === inspectedId}
          onInspect={onInspect}
        />
      ))}
    </nav>
  );
}
