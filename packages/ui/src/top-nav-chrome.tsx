'use client';

import type { RefObject } from 'react';
import { LocalNav } from './local-nav.js';
import type { NavigationModule } from './navigation-presentation.js';
import { TopNavHeader } from './top-nav-header.js';
import type { TopNavSessionState } from './top-nav-session.js';
import type { TopNavProps, TopNavRefs } from './top-nav-types.js';

type TopNavChromeProps = Omit<TopNavProps, 'modules'> &
  TopNavRefs & {
    rootRef: RefObject<HTMLDivElement | null>;
    visibleModules: readonly NavigationModule[];
    state: TopNavSessionState;
  };

export function TopNavChrome({
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
