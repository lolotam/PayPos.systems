'use client';

import { useState } from 'react';
import { LocalNav } from './local-nav.js';
import { MegaMenu } from './mega-menu.js';
import { ModuleDrawer } from './module-drawer.js';
import type { NavigationChromeLabels, NavigationModule } from './navigation-presentation.js';
import { useNavigationMedia } from './use-navigation-media.js';

export type TopNavProps = {
  modules: readonly NavigationModule[];
  labels: NavigationChromeLabels;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onNavigate?: (() => void) | undefined;
};

function TopNavContent({
  modules,
  labels,
  currentModuleId,
  activePageId,
  visiblePageIds,
  onNavigate,
}: TopNavProps) {
  const [openId, setOpenId] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const currentModule = modules.find((module) => module.id === currentModuleId);
  return (
    <div className="flex w-full flex-col bg-sidebar text-sidebar-foreground">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border px-2 min-[1024px]:h-16">
        <nav
          aria-label={labels.navigation}
          className="hidden min-w-0 items-center gap-1 overflow-x-auto min-[700px]:flex"
        >
          {modules.map((module) => (
            <MegaMenu
              key={module.id}
              module={module}
              labels={labels}
              open={openId === module.id}
              current={module.id === currentModuleId}
              activePageId={activePageId}
              visiblePageIds={visiblePageIds}
              onOpenChange={(open) => setOpenId(open ? module.id : undefined)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
        <ModuleDrawer
          modules={modules}
          labels={labels}
          open={drawerOpen}
          currentModuleId={currentModuleId}
          activePageId={activePageId}
          visiblePageIds={visiblePageIds}
          onOpenChange={setDrawerOpen}
          onNavigate={onNavigate}
        />
      </header>
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

export function TopNav(props: TopNavProps) {
  const isPhone = useNavigationMedia('(max-width: 699px)');
  return <TopNavContent key={isPhone ? 'phone' : 'wide'} {...props} />;
}
