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

function isFocusTargetEligible(target: HTMLElement | undefined): target is HTMLElement {
  if (
    !target?.isConnected ||
    target === document.body ||
    target === document.documentElement ||
    target.closest('[aria-hidden="true"], [hidden], [inert]')
  ) {
    return false;
  }
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
  }
  return true;
}

function usePanelReturnFocus(
  panelRef: RefObject<HTMLDivElement | null>,
  openerRef: RefObject<HTMLElement | null> | undefined,
  fallbackRef: RefObject<HTMLButtonElement | null> | undefined,
) {
  const observedOpenerRef = useRef<HTMLElement | undefined>(undefined);
  const pendingFocusRef = useRef(false);
  const restoringFocusRef = useRef(false);

  const tryFocus = useCallback((target: HTMLElement | undefined) => {
    if (!isFocusTargetEligible(target)) return false;
    restoringFocusRef.current = true;
    try {
      target.focus();
      return document.activeElement === target;
    } finally {
      restoringFocusRef.current = false;
    }
  }, []);

  const focusReturnTarget = useCallback(() => {
    const opener = openerRef?.current ?? observedOpenerRef.current;
    if (opener && tryFocus(opener)) {
      pendingFocusRef.current = false;
      return;
    }
    const fallback = fallbackRef?.current;
    if (fallback && tryFocus(fallback)) pendingFocusRef.current = false;
  }, [fallbackRef, openerRef, tryFocus]);

  // Track focus only as a fallback for callers that cannot supply the opener.
  useEffect(() => {
    const rememberOpener = (target: EventTarget | null) => {
      if (
        !openerRef &&
        target instanceof HTMLElement &&
        target !== document.body &&
        target !== document.documentElement &&
        !panelRef.current?.contains(target)
      ) {
        observedOpenerRef.current = target;
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (restoringFocusRef.current) return;
      if (pendingFocusRef.current) pendingFocusRef.current = false;
      rememberOpener(event.target);
    };
    document.addEventListener('focusin', onFocusIn);
    rememberOpener(document.activeElement);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [openerRef, panelRef]);

  const requestFocus = useCallback(() => {
    pendingFocusRef.current = true;
    focusReturnTarget();
  }, [focusReturnTarget]);

  const cancelPendingFocus = useCallback(() => {
    pendingFocusRef.current = false;
  }, []);

  // Run after every committed render: a later commit may mount the fallback.
  const retryFocus = () => {
    if (pendingFocusRef.current) focusReturnTarget();
  };

  return { requestFocus, cancelPendingFocus, retryFocus };
}

export type ContextPanelProps = {
  workspaces: readonly NavigationWorkspace[];
  labels: ContextPanelLabels;
  currentWorkspaceId?: string | undefined;
  inspectedWorkspaceId?: string | undefined;
  panelOpen: boolean;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  openerRef?: RefObject<HTMLElement | null> | undefined;
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
  openerRef,
  returnFocusRef,
  onClose,
}: ContextPanelProps) {
  const dir = useDirection();
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestFocus, cancelPendingFocus, retryFocus } = usePanelReturnFocus(
    panelRef,
    openerRef,
    returnFocusRef,
  );
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    const didClose = wasOpen.current && !panelOpen;
    wasOpen.current = panelOpen;
    if (panelOpen) {
      cancelPendingFocus();
    } else if (didClose) {
      requestFocus();
    }
  }, [panelOpen, cancelPendingFocus, requestFocus]);
  useEffect(() => {
    retryFocus();
  });
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
