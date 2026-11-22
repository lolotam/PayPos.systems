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
  onInspect: (workspaceId: string) => void;
};

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
      {workspaces.map((workspace) => {
        const isCurrent = workspace.id === currentWorkspaceId;
        const inspected = workspace.id === inspectedId;
        return (
          <Button
            key={workspace.id}
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
            onClick={() => onInspect(workspace.id)}
            className={cn(
              'min-h-15 w-15 flex-col gap-1 p-1 text-xs',
              isCurrent && 'font-semibold underline decoration-2 underline-offset-4',
              inspected
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : SIDEBAR_GHOST_CLASSES,
            )}
          >
            <span aria-hidden="true" className="[&_svg]:size-5">
              {workspace.icon ?? <span className="size-5" />}
            </span>
            {isCurrent ? (
              <span aria-hidden="true" data-current-marker="" className="size-1.5 rounded-full bg-current" />
            ) : null}
          </Button>
        );
      })}
    </nav>
  );
}
