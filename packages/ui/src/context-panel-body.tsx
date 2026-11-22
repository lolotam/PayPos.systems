'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { useRef, useState, type RefObject } from 'react';
import { Button } from './button.js';
import { ContextPanelEmpty, ContextPanelSection } from './context-panel-section.js';
import { useDirection } from './direction-provider.js';
import { Input } from './input.js';
import {
  visiblePagesMatchingQuery,
  type ContextPanelLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';

export type ContextPanelBodyProps = {
  panelRef?: RefObject<HTMLDivElement | null> | undefined;
  workspace?: NavigationWorkspace | undefined;
  workspaces?: readonly NavigationWorkspace[] | undefined;
  currentWorkspaceId?: string | undefined;
  labels: ContextPanelLabels;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onInspect?: ((workspaceId: string) => void) | undefined;
  onClose: () => void;
};

type WorkspaceSwitcherProps = {
  workspaces?: readonly NavigationWorkspace[] | undefined;
  visiblePageIds?: readonly string[] | undefined;
  inspectedId?: string | undefined;
  currentWorkspaceId?: string | undefined;
  onInspect?: ((workspaceId: string) => void) | undefined;
};

function ContextPanelWorkspaceSwitcher({
  workspaces,
  visiblePageIds,
  inspectedId,
  currentWorkspaceId,
  onInspect,
}: WorkspaceSwitcherProps) {
  if (!onInspect || !workspaces) return null;
  const visible = workspaces.filter((item) =>
    item.sections.some(
      (section) => visiblePagesMatchingQuery(section.pages, visiblePageIds, '').length > 0,
    ),
  );
  if (visible.length <= 1) return null;
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
            data-current={isCurrent ? '' : undefined}
            onClick={() => onInspect(item.id)}
            className="min-h-11 px-2.5 text-xs"
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}

export function ContextPanelBody({
  panelRef: panelRefProp,
  workspace,
  workspaces,
  currentWorkspaceId,
  labels,
  activePageId,
  visiblePageIds,
  onInspect,
  onClose,
}: ContextPanelBodyProps) {
  const dir = useDirection();
  const [query, setQuery] = useState('');
  const localPanelRef = useRef<HTMLDivElement>(null);
  const panelRef = panelRefProp ?? localPanelRef;
  const sections = workspace?.sections ?? [];
  const hasVisiblePages = sections.some(
    (section) => visiblePagesMatchingQuery(section.pages, visiblePageIds, query).length > 0,
  );
  return (
    <div ref={panelRef} dir={dir} className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex shrink-0 items-center gap-2 ps-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {workspace?.label ?? labels.empty}
        </h2>
        <Button variant="sidebar" size="icon" aria-label={labels.close} onClick={onClose}>
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <ContextPanelWorkspaceSwitcher
        workspaces={workspaces}
        visiblePageIds={visiblePageIds}
        inspectedId={workspace?.id}
        currentWorkspaceId={currentWorkspaceId}
        onInspect={onInspect}
      />
      <Input
        type="search"
        value={query}
        aria-label={labels.filterPages}
        placeholder={labels.filterPages}
        onChange={(event) => setQuery(event.currentTarget.value)}
        className="shrink-0"
      />
      {hasVisiblePages ? (
        sections.map((section) => (
          <ContextPanelSection
            key={section.id}
            section={section}
            query={query}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
          />
        ))
      ) : (
        <ContextPanelEmpty labels={labels} />
      )}
    </div>
  );
}
