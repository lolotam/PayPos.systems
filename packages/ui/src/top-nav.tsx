'use client';

import { useMemo, useRef, type RefObject } from 'react';
import { LocalNav } from './local-nav.js';
import { MegaMenu } from './mega-menu.js';
import { ModuleDrawer } from './module-drawer.js';
import {
  moduleHasVisiblePages,
  visiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';
import { useTopNavSession, type TopNavSessionState } from './top-nav-session.js';
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

type TopNavHeaderProps = Omit<TopNavProps, 'modules'> & TopNavRefs & {
  visibleModules: readonly NavigationModule[];
  focusModuleId: string | undefined;
  openModuleId: string | undefined;
  state: TopNavSessionState;
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
            onOpenChange={(open) => state.setMenuOpen(open ? module.id : undefined)}
            onSwitchModule={state.switchModule}
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
    state: TopNavSessionState;
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
  visibilityKey: string;
  visibleModules: readonly NavigationModule[];
};

function TopNavContent({
  isPhone,
  visibilityKey,
  visibleModules,
  ...chromeProps
}: TopNavContentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const moduleTriggerRef = useRef<HTMLButtonElement>(null);
  const state = useTopNavSession({
    visibilityKey,
    isPhone,
    rootRef,
    drawerTriggerRef,
    moduleTriggerRef,
  });
  return (
    <TopNavChrome
      {...chromeProps}
      rootRef={rootRef}
      drawerTriggerRef={drawerTriggerRef}
      moduleTriggerRef={moduleTriggerRef}
      visibleModules={visibleModules}
      state={state}
    />
  );
}

function visibleNavigationKey(
  modules: readonly NavigationModule[],
  visiblePageIds?: readonly string[],
): string {
  return modules
    .map((module) => {
      const pageIds = module.sections
        .flatMap((section) => visiblePages(section.pages, visiblePageIds))
        .map((page) => page.id)
        .join('\u0001');
      return `${module.id}\u0002${pageIds}`;
    })
    .join('\u0000');
}

export function TopNav({ modules, visiblePageIds, ...chromeProps }: TopNavProps) {
  const isPhone = useNavigationMedia('(max-width: 699px)');
  const visibleModules = useMemo(
    () => modules.filter((module) => moduleHasVisiblePages(module, visiblePageIds)),
    [modules, visiblePageIds],
  );
  const visibilityKey = useMemo(
    () => visibleNavigationKey(visibleModules, visiblePageIds),
    [visibleModules, visiblePageIds],
  );
  return (
    <TopNavContent
      isPhone={isPhone}
      visibilityKey={visibilityKey}
      visiblePageIds={visiblePageIds}
      visibleModules={visibleModules}
      {...chromeProps}
    />
  );
}
