'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { LocalNav } from './local-nav.js';
import { MegaMenu } from './mega-menu.js';
import { ModuleDrawer } from './module-drawer.js';
import {
  moduleHasVisiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';
import { useNavigationMedia } from './use-navigation-media.js';

export type TopNavProps = {
  modules: readonly NavigationModule[];
  labels: NavigationChromeLabels;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onNavigate?: (() => void) | undefined;
};

type TopNavRefs = {
  drawerTriggerRef: RefObject<HTMLButtonElement | null>;
  moduleTriggerRef: RefObject<HTMLButtonElement | null>;
};

type TopNavState = {
  openId: string | undefined;
  setOpenId: (id: string | undefined) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
};

type TopNavHeaderProps = Omit<TopNavProps, 'modules'> & TopNavRefs & {
  visibleModules: readonly NavigationModule[];
  focusModuleId: string | undefined;
  openModuleId: string | undefined;
  state: TopNavState;
};

function TopNavHeader({
  labels,
  currentModuleId,
  activePageId,
  visiblePageIds,
  onNavigate,
  visibleModules,
  focusModuleId,
  openModuleId,
  drawerTriggerRef,
  moduleTriggerRef,
  state,
}: TopNavHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border px-2 min-[1024px]:h-16">
      <nav
        aria-label={labels.navigation}
        className="hidden min-w-0 items-center gap-1 overflow-x-auto min-[700px]:flex"
      >
        {visibleModules.map((module) => (
          <MegaMenu
            key={module.id}
            modules={visibleModules}
            module={module}
            currentModuleId={currentModuleId}
            labels={labels}
            open={openModuleId === module.id}
            current={module.id === currentModuleId}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
            triggerRef={module.id === focusModuleId ? moduleTriggerRef : undefined}
            onCloseAutoFocus={state.onCloseAutoFocus}
            onOpenChange={(open) => state.setOpenId(open ? module.id : undefined)}
            onSwitchModule={state.setOpenId}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <ModuleDrawer
        modules={visibleModules}
        labels={labels}
        open={state.drawerOpen}
        currentModuleId={currentModuleId}
        activePageId={activePageId}
        visiblePageIds={visiblePageIds}
        triggerRef={drawerTriggerRef}
        onCloseAutoFocus={state.onCloseAutoFocus}
        onOpenChange={state.setDrawerOpen}
        onNavigate={onNavigate}
      />
    </header>
  );
}

type TopNavChromeProps = Omit<TopNavProps, 'modules'> &
  TopNavRefs & {
    rootRef: RefObject<HTMLDivElement | null>;
    visibleModules: readonly NavigationModule[];
    state: TopNavState;
  };

function TopNavChrome({
  labels,
  currentModuleId,
  activePageId,
  visiblePageIds,
  onNavigate,
  rootRef,
  drawerTriggerRef,
  moduleTriggerRef,
  visibleModules,
  state,
}: TopNavChromeProps) {
  const currentModule = visibleModules.find((module) => module.id === currentModuleId);
  const focusModuleId = currentModule?.id ?? visibleModules[0]?.id;
  const openModuleId =
    state.openId && visibleModules.some((module) => module.id === state.openId)
      ? state.openId
      : undefined;

  if (visibleModules.length === 0) return null;

  return (
    <div ref={rootRef} className="flex w-full flex-col bg-sidebar text-sidebar-foreground">
      <TopNavHeader
        labels={labels}
        currentModuleId={currentModuleId}
        activePageId={activePageId}
        visiblePageIds={visiblePageIds}
        onNavigate={onNavigate}
        visibleModules={visibleModules}
        focusModuleId={focusModuleId}
        openModuleId={openModuleId}
        drawerTriggerRef={drawerTriggerRef}
        moduleTriggerRef={moduleTriggerRef}
        state={state}
      />
      {currentModule ? (
        <LocalNav
          module={currentModule}
          labels={labels}
          activePageId={activePageId}
          visiblePageIds={visiblePageIds}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}

type TopNavContentProps = Omit<TopNavProps, 'modules'> & {
  isPhone: boolean;
  visibleModules: readonly NavigationModule[];
};

function TopNavContent({ isPhone, visibleModules, ...chromeProps }: TopNavContentProps) {
  const [openId, setOpenId] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const moduleTriggerRef = useRef<HTMLButtonElement>(null);
  const previousIsPhone = useRef(isPhone);
  const breakpointFocusTarget = useRef<HTMLElement | undefined>(undefined);

  useEffect(() => {
    const wasPhone = previousIsPhone.current;
    if (wasPhone === isPhone) return;
    previousIsPhone.current = isPhone;
    const active = document.activeElement;
    const focusInNav =
      Boolean(openId || drawerOpen) ||
      (rootRef.current !== null && active !== null && rootRef.current.contains(active));
    const target = isPhone ? drawerTriggerRef.current : moduleTriggerRef.current;
    breakpointFocusTarget.current = focusInNav ? (target ?? undefined) : undefined;
    setOpenId(undefined);
    setDrawerOpen(false);
    if (!openId && !drawerOpen && focusInNav) target?.focus();
  }, [drawerOpen, isPhone, openId]);

  const onCloseAutoFocus = (event: Event) => {
    const target = breakpointFocusTarget.current;
    if (!target) return;
    event.preventDefault();
    breakpointFocusTarget.current = undefined;
    target.focus();
  };

  return (
    <TopNavChrome
      {...chromeProps}
      rootRef={rootRef}
      drawerTriggerRef={drawerTriggerRef}
      moduleTriggerRef={moduleTriggerRef}
      visibleModules={visibleModules}
      state={{ openId, setOpenId, drawerOpen, setDrawerOpen, onCloseAutoFocus }}
    />
  );
}

export function TopNav({ modules, visiblePageIds, ...chromeProps }: TopNavProps) {
  const isPhone = useNavigationMedia('(max-width: 699px)');
  const visibleModules = useMemo(
    () => modules.filter((module) => moduleHasVisiblePages(module, visiblePageIds)),
    [modules, visiblePageIds],
  );
  return (
    <TopNavContent
      key={visibleModules.length > 0 ? 'visible' : 'hidden'}
      isPhone={isPhone}
      visiblePageIds={visiblePageIds}
      visibleModules={visibleModules}
      {...chromeProps}
    />
  );
}
