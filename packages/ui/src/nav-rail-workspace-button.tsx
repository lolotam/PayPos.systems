'use client';

import { Button } from './button.js';
import type { NavigationChromeLabels, NavigationWorkspace } from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

type RailWorkspaceButtonProps = {
  workspace: NavigationWorkspace;
  labels: NavigationChromeLabels;
  isCurrent: boolean;
  inspected: boolean;
  onInspect: (workspaceId: string, opener: HTMLButtonElement) => void;
};

export function RailWorkspaceButton({
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
      title={workspace.icon ? workspace.label : undefined}
      data-current={isCurrent ? '' : undefined}
      data-workspace-id={workspace.id}
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
          className="line-clamp-2 w-full whitespace-normal break-words text-center leading-tight"
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
