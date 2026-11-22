'use client';

import { Button } from './button.js';
import { moduleHasVisiblePages, type NavigationWorkspace } from './navigation-presentation.js';
import { cn } from './shared/cn.js';

type WorkspaceSwitcherProps = {
  workspaces?: readonly NavigationWorkspace[] | undefined;
  visiblePageIds?: readonly string[] | undefined;
  inspectedId?: string | undefined;
  currentWorkspaceId?: string | undefined;
  onInspect?: ((workspaceId: string) => void) | undefined;
};

export function ContextPanelWorkspaceSwitcher({
  workspaces,
  visiblePageIds,
  inspectedId,
  currentWorkspaceId,
  onInspect,
}: WorkspaceSwitcherProps) {
  if (!onInspect || !workspaces) return null;
  const visible = workspaces.filter((item) => moduleHasVisiblePages(item, visiblePageIds));
  if (visible.length === 0 || (visible.length === 1 && visible[0]?.id === inspectedId)) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-1">
      {visible.map((item) => {
        const inspected = item.id === inspectedId;
        const isCurrent = item.id === currentWorkspaceId;
        return (
          <Button
            key={item.id}
            variant={inspected ? 'secondary' : 'sidebar'}
            size="sm"
            aria-pressed={inspected}
            aria-current={isCurrent ? 'page' : undefined}
            data-current={isCurrent ? '' : undefined}
            onClick={() => onInspect(item.id)}
            className={cn(
              'min-h-11 min-w-11 max-w-full gap-1.5 px-2.5 text-xs',
              isCurrent && 'font-semibold underline decoration-2 underline-offset-4',
            )}
          >
            <span className="truncate">{item.label}</span>
            {isCurrent ? (
              <span
                aria-hidden="true"
                data-current-marker=""
                className="size-1.5 shrink-0 rounded-full bg-current"
              />
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
