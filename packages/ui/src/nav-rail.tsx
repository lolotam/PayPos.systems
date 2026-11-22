'use client';

import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import {
  resolveInspectedWorkspaceId,
  type NavigationChromeLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

export type NavRailProps = {
  workspaces: readonly NavigationWorkspace[];
  labels: NavigationChromeLabels;
  currentWorkspaceId?: string | undefined;
  inspectedWorkspaceId?: string | undefined;
  panelOpen: boolean;
  onInspect: (workspaceId: string, opener: HTMLButtonElement) => void;
};

type RailWorkspaceButtonProps = {
  workspace: NavigationWorkspace;
  labels: NavigationChromeLabels;
  isCurrent: boolean;
  inspected: boolean;
  onInspect: (workspaceId: string, opener: HTMLButtonElement) => void;
};

function RailWorkspaceButton({
  workspace,
  labels,
  isCurrent,
  inspected,
  onInspect,
}: RailWorkspaceButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={[
        workspace.label,
        isCurrent ? labels.current : '',
        inspected ? labels.hidePanel : labels.inspect,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={inspected}
      data-current={isCurrent ? '' : undefined}
      onClick={(event) => onInspect(workspace.id, event.currentTarget)}
      className={cn(
        'min-h-15 w-15 flex-col gap-1 p-1 text-xs',
        isCurrent && 'font-semibold underline decoration-2 underline-offset-4',
        inspected ? 'bg-sidebar-primary text-sidebar-primary-foreground' : SIDEBAR_GHOST_CLASSES,
      )}
    >
      {workspace.icon ? (
        <span aria-hidden="true" className="[&_svg]:size-5">
          {workspace.icon}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="line-clamp-2 w-full break-words text-center leading-tight"
        >
          {workspace.label}
        </span>
      )}
      {isCurrent ? (
        <span aria-hidden="true" data-current-marker="" className="size-1.5 rounded-full bg-current" />
      ) : null}
    </Button>
  );
}

export function NavRail({
  workspaces,
  labels,
  currentWorkspaceId,
  inspectedWorkspaceId,
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
      {workspaces.map((workspace) => (
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
