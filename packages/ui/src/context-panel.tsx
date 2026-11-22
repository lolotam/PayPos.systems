'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useDirection } from './direction-provider.js';
import { ContextPanelBody } from './context-panel-body.js';
import { ContextPanelFloating } from './context-panel-floating.js';
import {
  resolveInspectedWorkspaceId,
  type ContextPanelLabels,
  type NavigationWorkspace,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { useNavigationMedia } from './use-navigation-media.js';

const TABLET_OVERLAY_QUERY = '(min-width: 600px) and (width < 1024px)';

type FocusTarget = HTMLElement | SVGElement;

function isFocusTargetEligible(target: FocusTarget | undefined): target is FocusTarget {
  if (
    !target?.isConnected ||
    target === document.body ||
    target === document.documentElement ||
    target.closest('[aria-hidden="true"], [hidden], [inert]')
  ) {
    return false;
  }
  for (let node: Element | null = target; node; node = node.parentElement) {
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

const PENDING_FOCUS_ATTRIBUTES = [
  'aria-hidden',
  'hidden',
  'inert',
  'style',
  'class',
  'disabled',
];

function usePendingFocusObserver(onMutation: () => void) {
  const observerRef = useRef<MutationObserver | null>(null);
  const stopObserving = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);
  const startObserving = useCallback(() => {
    if (observerRef.current || typeof MutationObserver === 'undefined' || !document.body) return;
    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: PENDING_FOCUS_ATTRIBUTES,
    });
    observerRef.current = observer;
  }, [onMutation]);
  useEffect(() => stopObserving, [stopObserving]);
  return { startObserving, stopObserving };
}

type OutsideFocusTrackerInput = {
  panelRef: RefObject<HTMLDivElement | null>;
  openerRef: RefObject<HTMLElement | null> | undefined;
  freezeObservedOpener: boolean;
  restoringFocusRef: RefObject<boolean>;
  pendingFocusRef: RefObject<boolean>;
  cancelPendingFocus: () => void;
};

function useOutsideFocusTracker({
  panelRef,
  openerRef,
  freezeObservedOpener,
  restoringFocusRef,
  pendingFocusRef,
  cancelPendingFocus,
}: OutsideFocusTrackerInput) {
  const observedOpenerRef = useRef<HTMLElement | undefined>(undefined);
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
      if (pendingFocusRef.current) cancelPendingFocus();
      if (!freezeObservedOpener) rememberOpener(event.target);
    };
    document.addEventListener('focusin', onFocusIn);
    if (!freezeObservedOpener || !observedOpenerRef.current) {
      rememberOpener(document.activeElement);
    }
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [
    cancelPendingFocus,
    freezeObservedOpener,
    openerRef,
    panelRef,
    pendingFocusRef,
    restoringFocusRef,
  ]);
  return observedOpenerRef;
}

// لو اللوحة اتقفلت والتركيز على عنصر ظاهر براها (حقل بيتكتب فيه، أو صفحة جديدة أخدت التركيز
// في نفس الـ commit) بنسيبه مكانه. لما التركيز كان جوه اللوحة بيرجع للـ body بعد إزالتها،
// وساعتها بس بنرجّعه للزر الفاتح أو البديل.
function hasLiveExternalFocus(): boolean {
  const active = document.activeElement;
  const focusable = active instanceof HTMLElement || active instanceof SVGElement;
  return focusable && isFocusTargetEligible(active);
}

// عند 1024px شجرة الـ modal بتتشال وبتتبدل بلوحة ثابتة، فالتركيز اللي كان محبوس جواها بيقع على body.
// بننقله لأول عنصر في اللوحة الجديدة، إلا لو عنصر ظاهر براها أخد التركيز.
function useFloatingToStaticFocus(panelRef: RefObject<HTMLDivElement | null>, floating: boolean) {
  const wasFloating = useRef(floating);
  useEffect(() => {
    const becameStatic = wasFloating.current && !floating;
    wasFloating.current = floating;
    if (becameStatic && !hasLiveExternalFocus()) {
      panelRef.current?.querySelector<HTMLElement>('button, a[href], input')?.focus();
    }
  }, [floating, panelRef]);
}

type PanelReturnFocusInput = {
  panelRef: RefObject<HTMLDivElement | null>;
  panelOpen: boolean;
  freezeObservedOpener: boolean;
  openerRef: RefObject<HTMLElement | null> | undefined;
  fallbackRef: RefObject<HTMLButtonElement | null> | undefined;
};

function usePanelReturnFocus({
  panelRef,
  panelOpen,
  freezeObservedOpener,
  openerRef,
  fallbackRef,
}: PanelReturnFocusInput) {
  useFloatingToStaticFocus(panelRef, freezeObservedOpener);
  const pendingFocusRef = useRef(false);
  const restoringFocusRef = useRef(false);
  const onMutationRef = useRef<() => void>(() => undefined);
  const { startObserving, stopObserving } = usePendingFocusObserver(
    useCallback(() => onMutationRef.current(), []),
  );
  const cancelPendingFocus = useCallback(() => {
    pendingFocusRef.current = false;
    stopObserving();
  }, [stopObserving]);
  const observedOpenerRef = useOutsideFocusTracker({
    panelRef, openerRef, freezeObservedOpener, restoringFocusRef, pendingFocusRef, cancelPendingFocus,
  });

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
  const attemptRestore = useCallback(() => {
    const opener = openerRef?.current ?? observedOpenerRef.current;
    if ((opener && tryFocus(opener)) || (fallbackRef?.current && tryFocus(fallbackRef.current))) {
      cancelPendingFocus();
      return true;
    }
    return false;
  }, [cancelPendingFocus, fallbackRef, observedOpenerRef, openerRef, tryFocus]);
  useEffect(() => {
    onMutationRef.current = () => {
      if (pendingFocusRef.current) attemptRestore();
    };
  }, [attemptRestore]);
  const wasOpen = useRef(panelOpen);
  useEffect(() => {
    const didClose = wasOpen.current && !panelOpen;
    wasOpen.current = panelOpen;
    if (panelOpen) cancelPendingFocus();
    else if (didClose && !hasLiveExternalFocus()) {
      pendingFocusRef.current = true;
      if (!attemptRestore()) startObserving();
    }
  }, [attemptRestore, cancelPendingFocus, panelOpen, startObserving]);
  useEffect(() => {
    if (pendingFocusRef.current) attemptRestore();
  });
}

const PANEL_CLASS_NAME = cn(
  'hidden min-[600px]:fixed min-[600px]:inset-y-0 min-[600px]:start-21 min-[600px]:z-20 min-[600px]:flex min-[600px]:w-68 min-[600px]:border-e min-[600px]:border-sidebar-border min-[600px]:bg-sidebar min-[600px]:text-sidebar-foreground min-[600px]:shadow-lg',
  'min-[1024px]:static min-[1024px]:z-auto min-[1024px]:shadow-none',
);

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
  onInspect?: ((workspaceId: string) => void) | undefined;
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
  onInspect,
  onClose,
}: ContextPanelProps) {
  const dir = useDirection();
  const isFloatingOverlay = useNavigationMedia(TABLET_OVERLAY_QUERY);
  const panelRef = useRef<HTMLDivElement>(null);
  const inspectedId = resolveInspectedWorkspaceId({
    currentWorkspaceId,
    inspectedWorkspaceId,
    panelOpen,
  });
  usePanelReturnFocus({
    panelRef,
    panelOpen,
    freezeObservedOpener: panelOpen && isFloatingOverlay,
    openerRef,
    fallbackRef: returnFocusRef,
  });
  if (!panelOpen) return null;
  const body = (
    <ContextPanelBody
      panelRef={panelRef}
      workspace={workspaces.find((item) => item.id === inspectedId)}
      workspaces={isFloatingOverlay ? workspaces : undefined}
      currentWorkspaceId={currentWorkspaceId}
      labels={labels}
      activePageId={activePageId}
      visiblePageIds={visiblePageIds}
      onInspect={isFloatingOverlay ? onInspect : undefined}
      onClose={onClose}
    />
  );
  if (isFloatingOverlay) {
    return (
      <ContextPanelFloating
        dir={dir}
        title={labels.navigation}
        className={PANEL_CLASS_NAME}
        onClose={onClose}
      >
        {body}
      </ContextPanelFloating>
    );
  }
  return (
    <aside dir={dir} aria-label={labels.navigation} className={PANEL_CLASS_NAME}>
      {body}
    </aside>
  );
}
