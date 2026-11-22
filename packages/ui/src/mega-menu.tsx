'use client';

import { Dialog } from 'radix-ui';
import { useCallback, useRef, type Ref } from 'react';
import { Button } from './button.js';
import { MegaMenuContent } from './mega-menu-content.js';
import type { NavigationChromeLabels, NavigationModule } from './navigation-presentation.js';
import { cn } from './shared/cn.js';

export type MegaMenuProps = {
  modules: readonly NavigationModule[];
  module: NavigationModule;
  labels: NavigationChromeLabels;
  open: boolean;
  current?: boolean | undefined;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  triggerRef?: Ref<HTMLButtonElement> | undefined;
  onCloseAutoFocus?: ((event: Event, moduleId: string) => void) | undefined;
  onOpenChange: (open: boolean, opener?: HTMLElement) => void;
  onSwitchModule: (moduleId: string) => void;
  onNavigate?: (() => void) | undefined;
};

function assignTriggerRef(ref: Ref<HTMLButtonElement> | undefined, node: HTMLButtonElement | null) {
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  if (ref) (ref as { current: HTMLButtonElement | null }).current = node;
}

function useMegaMenuTrigger(
  triggerRef: Ref<HTMLButtonElement> | undefined,
  onOpenChange: (open: boolean, opener?: HTMLElement) => void,
) {
  const localTriggerRef = useRef<HTMLButtonElement | null>(null);
  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      localTriggerRef.current = node;
      assignTriggerRef(triggerRef, node);
    },
    [triggerRef],
  );
  const handleOpenChange = useCallback(
    (next: boolean) => onOpenChange(next, next ? (localTriggerRef.current ?? undefined) : undefined),
    [localTriggerRef, onOpenChange],
  );
  return { setTriggerRef, handleOpenChange };
}

export function MegaMenu({
  modules,
  module,
  labels,
  open,
  current = false,
  currentModuleId,
  activePageId,
  visiblePageIds,
  triggerRef,
  onCloseAutoFocus,
  onOpenChange,
  onSwitchModule,
  onNavigate,
}: MegaMenuProps) {
  const { setTriggerRef, handleOpenChange } = useMegaMenuTrigger(triggerRef, onOpenChange);
  const select = () => {
    onNavigate?.();
    onOpenChange(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <Button
          ref={setTriggerRef}
          variant="ghost"
          size="sm"
          aria-current={current ? 'page' : undefined}
          className={cn(
            'min-h-11 min-w-11 max-w-64 shrink-0 gap-1 rounded-none px-3',
            current && 'font-semibold underline decoration-2 underline-offset-4',
          )}
        >
          <span className="min-w-0 truncate">{module.label}</span>
          {current ? (
            <span aria-hidden="true" data-current-marker="" className="size-1.5 shrink-0 rounded-full bg-current" />
          ) : null}
          <span className="sr-only">{labels.openMenu}</span>
          {current ? <span className="sr-only">{labels.current}</span> : null}
        </Button>
      </Dialog.Trigger>
      {open ? (
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <MegaMenuContent
            modules={modules}
            module={module}
            labels={labels}
            currentModuleId={currentModuleId}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
            onSwitchModule={onSwitchModule}
            onCloseAutoFocus={onCloseAutoFocus}
            onSelect={select}
          />
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}
