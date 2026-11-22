'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

export type NavigationLayout = 'phone' | 'tablet' | 'desktop';

export type TopNavSessionState = {
  openId: string | undefined;
  setMenuOpen: (id: string | undefined, opener?: HTMLElement) => void;
  switchModule: (id: string) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  onCloseAutoFocus: (event: Event, moduleId?: string) => void;
};

type Session = {
  visibilityKey: string;
  openId: string | undefined;
  drawerOpen: boolean;
  opener: HTMLElement | undefined;
  switchCloseIds: readonly string[];
};

type SetSession = Dispatch<SetStateAction<Session>>;

type FocusTargets = {
  rootRef: RefObject<HTMLDivElement | null>;
  drawerTriggerRef: RefObject<HTMLButtonElement | null>;
  moduleTriggerRef: RefObject<HTMLButtonElement | null>;
};

type UseTopNavSessionArgs = FocusTargets & {
  visibilityKey: string;
  layout: NavigationLayout;
};

function freshSession(visibilityKey: string): Session {
  return {
    visibilityKey,
    openId: undefined,
    drawerOpen: false,
    opener: undefined,
    switchCloseIds: [],
  };
}

function invalidatedSession(visibilityKey: string, previous: Session): Session {
  const opener = previous.opener?.isConnected ? previous.opener : undefined;
  return {
    ...freshSession(visibilityKey),
    opener,
    switchCloseIds: opener ? previous.switchCloseIds : [],
  };
}

function useVisibilitySession(visibilityKey: string): [Session, SetSession] {
  const [session, setSession] = useState(() => freshSession(visibilityKey));
  if (session.visibilityKey !== visibilityKey) {
    const invalidated = invalidatedSession(visibilityKey, session);
    setSession(invalidated);
    return [invalidated, setSession];
  }
  return [session, setSession];
}

type BreakpointFocusArgs = FocusTargets & {
  layout: NavigationLayout;
  hasOpenDialog: boolean;
  closeDialogs: () => void;
};

function useBreakpointFocus({
  layout,
  rootRef,
  drawerTriggerRef,
  moduleTriggerRef,
  hasOpenDialog,
  closeDialogs,
}: BreakpointFocusArgs) {
  const previousLayout = useRef(layout);
  const target = useRef<HTMLElement | undefined>(undefined);
  useEffect(() => {
    if (previousLayout.current === layout) return;
    const crossedPhone = (previousLayout.current === 'phone') !== (layout === 'phone');
    previousLayout.current = layout;
    const active = document.activeElement;
    const focusInNav =
      hasOpenDialog ||
      (rootRef.current !== null && active !== null && rootRef.current.contains(active));
    const breakpointTarget = layout === 'phone' ? drawerTriggerRef.current : moduleTriggerRef.current;
    // Tablet <-> desktop keeps the opener visible, so ordinary close-focus restoration applies.
    target.current = crossedPhone && hasOpenDialog ? (breakpointTarget ?? undefined) : undefined;
    closeDialogs();
    if (crossedPhone && !hasOpenDialog && focusInNav) breakpointTarget?.focus();
  }, [closeDialogs, drawerTriggerRef, hasOpenDialog, layout, moduleTriggerRef, rootRef]);
  return target;
}

function openMenu(setSession: SetSession, id: string | undefined, opener?: HTMLElement) {
  setSession((previous) => ({
    ...previous,
    openId: id,
    drawerOpen: false,
    opener: id === undefined ? previous.opener : (previous.opener ?? opener),
    switchCloseIds:
      id === undefined
        ? previous.switchCloseIds
        : previous.switchCloseIds.filter((closedId) => closedId !== id),
  }));
}

function switchModule(setSession: SetSession, id: string) {
  setSession((previous) => {
    const closedId = previous.openId;
    const switchCloseIds = previous.switchCloseIds.filter((pendingId) => pendingId !== id);
    return {
      ...previous,
      openId: id,
      drawerOpen: false,
      switchCloseIds: closedId && closedId !== id ? [...switchCloseIds, closedId] : switchCloseIds,
    };
  });
}

function toggleDrawer(setSession: SetSession, open: boolean) {
  setSession((previous) => ({
    ...previous,
    openId: undefined,
    drawerOpen: open,
    opener: undefined,
  }));
}

function isVisibleOpener(opener: HTMLElement | undefined, isPhone: boolean, targets: FocusTargets) {
  if (!opener?.isConnected) return false;
  if (isPhone) return opener === targets.drawerTriggerRef.current;
  return (
    targets.rootRef.current !== null &&
    targets.rootRef.current.contains(opener) &&
    opener !== targets.drawerTriggerRef.current
  );
}

function focusTarget(
  event: Event,
  target: HTMLElement,
  moduleId: string | undefined,
  setSession: SetSession,
) {
  if (!target.isConnected) return false;
  target.focus();
  if (document.activeElement !== target) return false;
  event.preventDefault();
  setSession((previous) => ({
    ...previous,
    opener: undefined,
    switchCloseIds: previous.switchCloseIds.filter((pendingId) => pendingId !== moduleId),
  }));
  return true;
}

type RestoreFocusArgs = {
  event: Event;
  moduleId: string | undefined;
  current: Session;
  setSession: SetSession;
  isPhone: boolean;
  targets: FocusTargets;
  breakpointTargetRef: RefObject<HTMLElement | undefined>;
};

function focusBreakpointTarget({ event, breakpointTargetRef }: RestoreFocusArgs) {
  const target = breakpointTargetRef.current;
  if (!target) return;
  event.preventDefault();
  breakpointTargetRef.current = undefined;
  target.focus();
}

function isIntermediateClose({ moduleId, current }: RestoreFocusArgs) {
  return moduleId !== undefined && current.switchCloseIds.includes(moduleId);
}

function suppressIntermediateClose({ event, moduleId, setSession }: RestoreFocusArgs) {
  event.preventDefault();
  setSession((previous) => ({
    ...previous,
    switchCloseIds: previous.switchCloseIds.filter((pendingId) => pendingId !== moduleId),
  }));
}

function focusVisibleTrigger({
  event,
  moduleId,
  current,
  setSession,
  isPhone,
  targets,
}: RestoreFocusArgs) {
  const opener = current.opener;
  if (opener && isVisibleOpener(opener, isPhone, targets)) {
    if (focusTarget(event, opener, moduleId, setSession)) return;
  }
  const fallback = isPhone ? targets.drawerTriggerRef.current : targets.moduleTriggerRef.current;
  if (fallback) focusTarget(event, fallback, moduleId, setSession);
}

function restoreFocus(args: RestoreFocusArgs) {
  if (args.breakpointTargetRef.current) {
    focusBreakpointTarget(args);
    return;
  }
  if (isIntermediateClose(args)) {
    suppressIntermediateClose(args);
    return;
  }
  focusVisibleTrigger(args);
}

type SessionHandlersArgs = {
  latestSessionRef: RefObject<Session>;
  setSession: SetSession;
  isPhone: boolean;
  targets: FocusTargets;
  breakpointTargetRef: RefObject<HTMLElement | undefined>;
};

function createSessionHandlers({
  latestSessionRef,
  setSession,
  isPhone,
  targets,
  breakpointTargetRef,
}: SessionHandlersArgs): TopNavSessionState {
  return {
    openId: latestSessionRef.current.openId,
    setMenuOpen: (id, opener) => openMenu(setSession, id, opener),
    switchModule: (id) => switchModule(setSession, id),
    drawerOpen: latestSessionRef.current.drawerOpen,
    setDrawerOpen: (open) => toggleDrawer(setSession, open),
    onCloseAutoFocus: (event, moduleId) =>
      restoreFocus({
        event,
        moduleId,
        current: latestSessionRef.current,
        setSession,
        isPhone,
        targets,
        breakpointTargetRef,
      }),
  };
}

export function useTopNavSession({
  visibilityKey,
  layout,
  rootRef,
  drawerTriggerRef,
  moduleTriggerRef,
}: UseTopNavSessionArgs): TopNavSessionState {
  const [current, setSession] = useVisibilitySession(visibilityKey);
  const latestSessionRef = useRef(current);
  latestSessionRef.current = current;
  const closeDialogs = useCallback(() => {
    setSession((previous) => ({
      ...previous,
      openId: undefined,
      drawerOpen: false,
      opener: undefined,
      switchCloseIds: [],
    }));
  }, []);
  const breakpointTarget = useBreakpointFocus({
    layout,
    rootRef,
    drawerTriggerRef,
    moduleTriggerRef,
    hasOpenDialog: Boolean(current.openId || current.drawerOpen),
    closeDialogs,
  });
  return createSessionHandlers({
    latestSessionRef,
    setSession,
    isPhone: layout === 'phone',
    targets: { rootRef, drawerTriggerRef, moduleTriggerRef },
    breakpointTargetRef: breakpointTarget,
  });
}
