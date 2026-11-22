'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useDirection } from './direction-provider.js';
import { ContextPanelBody } from './context-panel-body.js';
import {
  resolveInspectedWorkspaceId,
  type ContextPanelLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';

function usePanelReturnFocus(
  panelRef: RefObject<HTMLDivElement | null>,
  fallbackRef: RefObject<HTMLButtonElement | null> | undefined,
) {
  const openerRef = useRef<HTMLElement | undefined>(undefined);
  // Track the last focus outside the panel so the close commit can restore it.
  useEffect(() => {
    const rememberFocus = (target: EventTarget | null) => {
      if (
        target instanceof HTMLElement &&
        target !== document.body &&
        !panelRef.current?.contains(target)
      ) {
        openerRef.current = target;
      }
    };
    const onFocusIn = (event: FocusEvent) => rememberFocus(event.target);
    document.addEventListener('focusin', onFocusIn);
    rememberFocus(document.activeElement);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [panelRef]);
  return useCallback(() => {
    const opener = openerRef.current;
    if (opener?.isConnected) {
      opener.focus();
      if (document.activeElement === opener) return;
    }
    const fallback = fallbackRef?.current;
    if (fallback?.isConnected) fallback.focus();
  }, [fallbackRef]);
}

export type ContextPanelProps = {
  workspaces: readonly NavigationWorkspace[];
  labels: ContextPanelLabels;
  currentWorkspaceId?: string | undefined;
  inspectedWorkspaceId?: string | undefined;
  panelOpen: boolean;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  returnFocusRef?: RefObject<HTMLButtonElement | null> | undefined;
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
  returnFocusRef,
  onClose,
}: ContextPanelProps) {
  const dir = useDirection();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = usePanelReturnFocus(panelRef, returnFocusRef);
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    const didClose = wasOpen.current && !panelOpen;
    wasOpen.current = panelOpen;
    if (didClose) restoreFocus();
  }, [panelOpen, restoreFocus]);
  if (!panelOpen) return null;
  const inspectedId = resolveInspectedWorkspaceId({
    currentWorkspaceId,
    inspectedWorkspaceId,
    panelOpen,
  });
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
        panelRef={panelRef}
        workspace={workspace}
        labels={labels}
        activePageId={activePageId}
        visiblePageIds={visiblePageIds}
        onClose={onClose}
      />
    </aside>
  );
}
