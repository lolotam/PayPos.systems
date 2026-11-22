'use client';

import { ListIcon, XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { useEffect, useState, type Ref } from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import {
  moduleHasVisiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';
import { ModuleDrawerSection } from './module-drawer-section.js';
import { useHydratedNavigationMedia } from './use-navigation-media.js';

export type ModuleDrawerProps = {
  modules: readonly NavigationModule[];
  labels: NavigationChromeLabels;
  open: boolean;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  triggerRef?: Ref<HTMLButtonElement> | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
  onOpenChange: (open: boolean) => void;
  onNavigate?: (() => void) | undefined;
};

type DrawerContentProps = Omit<ModuleDrawerProps, 'open' | 'onOpenChange' | 'triggerRef'> & {
  initialId?: string | undefined;
  onSelect: () => void;
};

function ModuleDrawerContent({
  modules,
  labels,
  currentModuleId,
  activePageId,
  visiblePageIds,
  initialId,
  onCloseAutoFocus,
  onSelect,
}: DrawerContentProps) {
  const dir = useDirection();
  const [expandedId, setExpandedId] = useState(initialId);
  return (
    <Dialog.Content
      dir={dir}
      aria-modal="true"
      aria-describedby={undefined}
      onCloseAutoFocus={onCloseAutoFocus}
      className="fixed inset-y-0 start-0 z-50 flex w-76 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto bg-sidebar text-sidebar-foreground"
    >
      <div className="flex shrink-0 items-center gap-2 ps-4 pe-2 pt-2">
        <Dialog.Title className="text-sm font-medium">{labels.drawerTitle}</Dialog.Title>
        <Dialog.Close asChild>
          <Button variant="sidebar" size="icon" className="ms-auto" aria-label={labels.close}>
            <XIcon aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </div>
      <nav aria-label={labels.navigation} className="flex-1 p-2">
        {modules.map((module) => (
          <ModuleDrawerSection
            key={module.id}
            module={module}
            labels={labels}
            expanded={expandedId === module.id}
            current={module.id === currentModuleId}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
            onToggle={() => setExpandedId(expandedId === module.id ? undefined : module.id)}
            onSelect={onSelect}
          />
        ))}
      </nav>
    </Dialog.Content>
  );
}

export function ModuleDrawer({
  modules,
  labels,
  open,
  currentModuleId,
  activePageId,
  visiblePageIds,
  triggerRef,
  onCloseAutoFocus,
  onOpenChange,
  onNavigate,
}: ModuleDrawerProps) {
  const { matches: isPhone, ready: mediaReady } = useHydratedNavigationMedia('(width < 700px)');
  const dialogOpen = open && isPhone;
  useEffect(() => {
    if (mediaReady && open && !isPhone) onOpenChange(false);
  }, [isPhone, mediaReady, onOpenChange, open]);
  const select = () => {
    onNavigate?.();
    onOpenChange(false);
  };
  const visibleModules = modules.filter((module) => moduleHasVisiblePages(module, visiblePageIds));
  if (visibleModules.length === 0) return null;
  const currentIsVisible = visibleModules.some((module) => module.id === currentModuleId);
  const initialId = currentIsVisible ? currentModuleId : visibleModules[0]?.id;
  return (
    <Dialog.Root open={dialogOpen} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          aria-label={labels.drawerOpen}
          className="min-[700px]:hidden"
        >
          <ListIcon aria-hidden="true" />
        </Button>
      </Dialog.Trigger>
      {dialogOpen ? (
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 min-[700px]:hidden" />
          <ModuleDrawerContent
            modules={visibleModules}
            labels={labels}
            currentModuleId={currentModuleId}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
            initialId={initialId}
            onCloseAutoFocus={onCloseAutoFocus}
            onSelect={select}
          />
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}
