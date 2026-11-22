'use client';

import { useEffect, useRef } from 'react';
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
  const railRef = useRef<HTMLElement>(null);
  const focusedId = useRef<string | undefined>(undefined);
  const visible = workspaces.filter((item) => moduleHasVisiblePages(item, visiblePageIds));
  const visibleKey = visible.map((item) => item.id).join('\u0000');
  useEffect(() => {
    // تحديث الصلاحيات ممكن يشيل زر مساحة العمل اللي عليه التركيز، فالتركيز بيقع على body.
    // بننقله للمساحة الحالية أو أول زر باقي، ومش بنلمسه لو المستخدم كان ساب الشريط.
    const id = focusedId.current;
    if (id === undefined || visibleKey.split('\u0000').includes(id)) return;
    focusedId.current = undefined;
    if (document.activeElement !== document.body) return;
    const rail = railRef.current;
    (rail?.querySelector<HTMLElement>('[data-current]') ?? rail?.querySelector('button'))?.focus();
  }, [visibleKey]);
  return (
    <nav
      ref={railRef}
      dir={dir}
      aria-label={labels.navigation}
      onFocus={(event) => {
        focusedId.current = event.target.closest<HTMLElement>('[data-workspace-id]')?.dataset['workspaceId'];
      }}
      onBlur={(event) => {
        if (event.relatedTarget) focusedId.current = undefined;
      }}
      className="flex w-21 shrink-0 flex-col items-center gap-1 bg-sidebar p-2"
    >
      {visible.map((workspace) => (
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
