'use client';

import { useDirection } from './direction-provider.js';
import { ContextPanelBody } from './context-panel-body.js';
import type { ContextPanelLabels, NavigationWorkspace } from './navigation-presentation.js';
import { cn } from './shared/cn.js';

export type ContextPanelProps = {
  workspaces: readonly NavigationWorkspace[];
  labels: ContextPanelLabels;
  currentWorkspaceId?: string | undefined;
  inspectedWorkspaceId?: string | undefined;
  panelOpen: boolean;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onClose: () => void;
};

export function ContextPanel({
  workspaces,
  labels,
  currentWorkspaceId,
  inspectedWorkspaceId,
  panelOpen,
  activePageId,
  visiblePageIds,
  onClose,
}: ContextPanelProps) {
  const dir = useDirection();
  if (!panelOpen) return null;
  const inspectedId = inspectedWorkspaceId ?? currentWorkspaceId;
  const workspace = workspaces.find((item) => item.id === inspectedId);
  return (
    <aside
      dir={dir}
      aria-label={labels.navigation}
      className={cn(
        'hidden min-[600px]:fixed min-[600px]:inset-y-0 min-[600px]:start-21 min-[600px]:z-20 min-[600px]:flex min-[600px]:w-68 min-[600px]:border-e min-[600px]:border-sidebar-border min-[600px]:bg-sidebar min-[600px]:text-sidebar-foreground min-[600px]:shadow-lg',
        'min-[1024px]:static min-[1024px]:z-auto min-[1024px]:shadow-none',
      )}
    >
      <ContextPanelBody
        workspace={workspace}
        labels={labels}
        activePageId={activePageId}
        visiblePageIds={visiblePageIds}
        onClose={onClose}
      />
    </aside>
  );
}
