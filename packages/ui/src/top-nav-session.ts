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

export type TopNavSessionState = {
  openId: string | undefined;
  setMenuOpen: (id: string | undefined) => void;
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
  intermediateCloseId: string | undefined;
};

type SetSession = Dispatch<SetStateAction<Session>>;

type UseTopNavSessionArgs = {
  visibilityKey: string;
  isPhone: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  drawerTriggerRef: RefObject<HTMLButtonElement | null>;
  moduleTriggerRef: RefObject<HTMLButtonElement | null>;
};

function freshSession(visibilityKey: string): Session {
  return {
    visibilityKey,
    openId: undefined,
    drawerOpen: false,
    opener: undefined,
    intermediateCloseId: undefined,
  };
}

function useVisibilitySession(visibilityKey: string): [Session, SetSession] {
  const [session, setSession] = useState(() => freshSession(visibilityKey));
  if (session.visibilityKey !== visibilityKey) setSession(freshSession(visibilityKey));
  const current = session.visibilityKey === visibilityKey ? session : freshSession(visibilityKey);
  return [current, setSession];
}

type BreakpointFocusArgs = Omit<UseTopNavSessionArgs, 'visibilityKey'> & {
  hasOpenDialog: boolean;
  closeDialogs: () => void;
};

function useBreakpointFocus({
  isPhone,
  rootRef,
  drawerTriggerRef,
  moduleTriggerRef,
  hasOpenDialog,
  closeDialogs,
}: BreakpointFocusArgs) {
  const previousIsPhone = useRef(isPhone);
  const target = useRef<HTMLElement | undefined>(undefined);
  useEffect(() => {
    if (previousIsPhone.current === isPhone) return;
    previousIsPhone.current = isPhone;
    const active = document.activeElement;
    const focusInNav =
      hasOpenDialog ||
      (rootRef.current !== null && active !== null && rootRef.current.contains(active));
    const breakpointTarget = isPhone ? drawerTriggerRef.current : moduleTriggerRef.current;
    target.current = hasOpenDialog ? (breakpointTarget ?? undefined) : undefined;
    closeDialogs();
    if (!hasOpenDialog && focusInNav) breakpointTarget?.focus();
  }, [closeDialogs, drawerTriggerRef, hasOpenDialog, isPhone, moduleTriggerRef, rootRef]);
  return target;
}

function openMenu(setSession: SetSession, id: string | undefined) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  setSession((previous) => ({
    ...previous,
    openId: id,
    drawerOpen: false,
    opener: id === undefined ? previous.opener : (previous.opener ?? opener),
    intermediateCloseId: id === undefined ? previous.intermediateCloseId : undefined,
  }));
}

function switchModule(setSession: SetSession, id: string) {
  setSession((previous) => ({
    ...previous,
    openId: id,
    drawerOpen: false,
    intermediateCloseId:
      previous.openId !== undefined && previous.openId !== id ? previous.openId : undefined,
  }));
}

function toggleDrawer(setSession: SetSession, open: boolean) {
  setSession((previous) => ({
    ...previous,
    openId: undefined,
    drawerOpen: open,
    opener: undefined,
    intermediateCloseId: undefined,
  }));
}

function restoreFocus(
  event: Event,
  moduleId: string | undefined,
  current: Session,
  setSession: SetSession,
  breakpointTargetRef: RefObject<HTMLElement | undefined>,
) {
  const breakpointTarget = breakpointTargetRef.current;
  if (breakpointTarget) {
    event.preventDefault();
    breakpointTargetRef.current = undefined;
    breakpointTarget.focus();
    return;
  }
  if (moduleId !== undefined && current.intermediateCloseId === moduleId) {
    setSession((previous) => ({ ...previous, intermediateCloseId: undefined }));
    return;
  }
  const opener = current.opener;
  if (!opener?.isConnected) return;
  event.preventDefault();
  setSession((previous) => ({ ...previous, opener: undefined, intermediateCloseId: undefined }));
  opener.focus();
}

function createSessionHandlers(
  current: Session,
  setSession: SetSession,
  breakpointTarget: RefObject<HTMLElement | undefined>,
): TopNavSessionState {
  return {
    openId: current.openId,
    setMenuOpen: (id) => openMenu(setSession, id),
    switchModule: (id) => switchModule(setSession, id),
    drawerOpen: current.drawerOpen,
    setDrawerOpen: (open) => toggleDrawer(setSession, open),
    onCloseAutoFocus: (event, moduleId) =>
      restoreFocus(event, moduleId, current, setSession, breakpointTarget),
  };
}

export function useTopNavSession({
  visibilityKey,
  isPhone,
  rootRef,
  drawerTriggerRef,
  moduleTriggerRef,
}: UseTopNavSessionArgs): TopNavSessionState {
  const [current, setSession] = useVisibilitySession(visibilityKey);
  const closeDialogs = useCallback(() => {
    setSession((previous) => ({
      ...previous,
      openId: undefined,
      drawerOpen: false,
      opener: undefined,
      intermediateCloseId: undefined,
    }));
  }, []);
  const breakpointTarget = useBreakpointFocus({
    isPhone,
    rootRef,
    drawerTriggerRef,
    moduleTriggerRef,
    hasOpenDialog: Boolean(current.openId || current.drawerOpen),
    closeDialogs,
  });
  return createSessionHandlers(current, setSession, breakpointTarget);
}
