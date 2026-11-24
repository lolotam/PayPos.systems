'use client';

import { ListIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { useEffect, type Ref } from 'react';
import { Button } from './button.js';
import { ModuleDrawerContent } from './module-drawer-content.js';
import {
  moduleHasVisiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';
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
          className="shrink-0 min-[700px]:hidden"
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
