'use client';

import { MegaMenu } from './mega-menu.js';
import { ModuleDrawer } from './module-drawer.js';
import type { NavigationModule } from './navigation-presentation.js';
import type { TopNavSessionState } from './top-nav-session.js';
import type { TopNavProps, TopNavRefs } from './top-nav-types.js';

type TopNavHeaderProps = Omit<TopNavProps, 'modules'> & TopNavRefs & {
  visibleModules: readonly NavigationModule[];
  focusModuleId: string | undefined;
  openModuleId: string | undefined;
  state: TopNavSessionState;
};

export function TopNavHeader({
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
        className="relative hidden min-w-0 items-center gap-1 overflow-x-auto min-[700px]:flex"
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
            onOpenChange={(next, opener) => state.setMenuOpen(next ? module.id : undefined, opener)}
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
