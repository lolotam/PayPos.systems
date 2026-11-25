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
  // من غير وحدات ظاهرة الـ TopNav بيرجع null، فمفيش جذر نقدر نكتب عليه علامة التخطيط المستقر.
  hasVisibleModules: boolean;
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

// عبور 700px بيخفي الزر اللي عليه التركيز بالـ CSS، فالمتصفح بيرجّع activeElement للـ body
// قبل ما الـ effect يشتغل. بنفتكر آخر تركيز كان جوه التنقل ولا لأ عشان ننقله للزر الظاهر،
// وضغطة براه بتلغي ده عشان ما نسحبش التركيز من مستخدم ساب التنقل.
function useLastFocusInNav(rootRef: RefObject<HTMLDivElement | null>) {
  const lastFocusInNav = useRef(false);
  useEffect(() => {
    const isInNav = (event: Event) =>
      event.target instanceof Node && (rootRef.current?.contains(event.target) ?? false);
    const onFocusIn = (event: FocusEvent) => {
      lastFocusInNav.current = isInNav(event);
    };
    // بعد pointerup وبعد click بنسأل سؤال واحد: التركيز لسه جوه التنقل؟ مكان الضغط أو الإفلات مش مهم.
    // click ضروري لأن متصفحات اللمس بتطبّق تغيير التركيز بعد pointerup، وقت أحداث الماوس المتوافقة.
    const forgetWhenFocusLeft = () => {
      if (!rootRef.current?.contains(document.activeElement)) lastFocusInNav.current = false;
    };
    // capture: محتوى الصفحة ممكن يوقف انتشار الحدث، ولازم نشوفه برضه.
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('pointerup', forgetWhenFocusLeft, true);
    document.addEventListener('click', forgetWhenFocusLeft, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerup', forgetWhenFocusLeft, true);
      document.removeEventListener('click', forgetWhenFocusLeft, true);
    };
  }, [rootRef]);
  return lastFocusInNav;
}

type BreakpointFocusArgs = FocusTargets & {
  layout: NavigationLayout;
  hasOpenDialog: boolean;
  hasVisibleModules: boolean;
  closeDialogs: () => void;
};

function useBreakpointFocus({
  layout,
  rootRef,
  drawerTriggerRef,
  moduleTriggerRef,
  hasOpenDialog,
  hasVisibleModules,
  closeDialogs,
}: BreakpointFocusArgs) {
  const previousLayout = useRef(layout);
  const target = useRef<HTMLElement | undefined>(undefined);
  const lastFocusInNav = useLastFocusInNav(rootRef);
  useEffect(() => {
    if (previousLayout.current === layout) return;
    const crossedPhone = (previousLayout.current === 'phone') !== (layout === 'phone');
    previousLayout.current = layout;
    const active = document.activeElement;
    const focusLost = active === null || active === document.body;
    const focusInNav =
      hasOpenDialog ||
      (focusLost
        ? lastFocusInNav.current
        : rootRef.current !== null && rootRef.current.contains(active));
    const breakpointTarget = layout === 'phone' ? drawerTriggerRef.current : moduleTriggerRef.current;
    // Tablet <-> desktop keeps the opener visible, so ordinary close-focus restoration applies.
    target.current = crossedPhone && hasOpenDialog ? (breakpointTarget ?? undefined) : undefined;
    closeDialogs();
    if (crossedPhone && !hasOpenDialog && focusInNav) breakpointTarget?.focus();
  }, [
    closeDialogs,
    drawerTriggerRef,
    hasOpenDialog,
    lastFocusInNav,
    layout,
    moduleTriggerRef,
    rootRef,
  ]);
  // ظهور الأزرار عند نقطة التحول بييجي من CSS قبل ما React يعالج التغيير. العلامة دي بتتكتب بعد
  // effect نقل التركيز في نفس الدورة، فأي فاحص خارجي يقدر يستنى قرار التركيز الفعلي (#1207).
  // الوحدات ممكن تظهر بعد بناء الشريط دون تغيير العرض، فالعلامة لازم تتكتب فور
  // تركيب الجذر، وإلا ينتظر الفاحص الخارجي علامة لن تصل.
  useEffect(() => {
    if (hasVisibleModules) rootRef.current?.setAttribute('data-settled-layout', layout);
  }, [hasVisibleModules, layout, rootRef]);
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

function focusBreakpointTarget({ event, breakpointTargetRef, setSession }: RestoreFocusArgs) {
  const target = breakpointTargetRef.current;
  if (!target) return;
  event.preventDefault();
  breakpointTargetRef.current = undefined;
  target.focus();
  // Breakpoint focus replaces the stored opener; leaving it would reuse the
  // old trigger for the next menu opened after the layout change.
  setSession((previous) => ({ ...previous, opener: undefined }));
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
  hasVisibleModules,
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
      // Keep the opener until onCloseAutoFocus consumes it; clearing it here
      // makes breakpoint close restore focus to the current module instead.
      switchCloseIds: [],
    }));
  }, []);
  const breakpointTarget = useBreakpointFocus({
    layout,
    rootRef,
    drawerTriggerRef,
    moduleTriggerRef,
    hasOpenDialog: Boolean(current.openId || current.drawerOpen),
    hasVisibleModules,
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
