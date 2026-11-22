'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { type KeyboardEvent, type Ref } from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import {
  visiblePages,
  type NavigationChromeLabels,
  type NavigationModule,
  type NavigationSection,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

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
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
  onOpenChange: (open: boolean) => void;
  onSwitchModule: (moduleId: string) => void;
  onNavigate?: (() => void) | undefined;
};

type MegaMenuSectionProps = {
  section: NavigationSection;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onSelect: () => void;
};

function MegaMenuSection({
  section,
  activePageId,
  visiblePageIds,
  onSelect,
}: MegaMenuSectionProps) {
  return (
    <section aria-label={section.label} className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{section.label}</h3>
      <ul className="flex flex-col gap-1">
        {visiblePages(section.pages, visiblePageIds).map((page) => (
          <li key={page.id}>
            <a
              href={page.href}
              aria-current={page.id === activePageId ? 'page' : undefined}
              onClick={onSelect}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-interactive px-3 py-2 text-sm',
                page.id === activePageId
                  ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
                  : SIDEBAR_GHOST_CLASSES,
              )}
            >
              <span className="truncate">{page.label}</span>
              {page.status ? <span className="shrink-0 text-xs opacity-80">{page.status}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

type MegaMenuContentProps = {
  modules: readonly NavigationModule[];
  module: NavigationModule;
  labels: NavigationChromeLabels;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onSwitchModule: (moduleId: string) => void;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
  onSelect: () => void;
};

function switchOnKeyboard(
  event: KeyboardEvent<HTMLButtonElement>,
  moduleId: string,
  onSwitchModule: (moduleId: string) => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onSwitchModule(moduleId);
}

type ModuleSwitcherProps = {
  modules: readonly NavigationModule[];
  currentModuleId?: string | undefined;
  labels: NavigationChromeLabels;
  onSwitchModule: (moduleId: string) => void;
};

function ModuleSwitcher({
  modules,
  currentModuleId,
  labels,
  onSwitchModule,
}: ModuleSwitcherProps) {
  return (
    <nav aria-label={labels.navigation} className="mb-4 flex flex-wrap gap-1 border-b border-border pb-3">
      {modules.map((item) => {
        const isCurrent = item.id === currentModuleId;
        return (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => onSwitchModule(item.id)}
            onKeyDown={(event) => switchOnKeyboard(event, item.id, onSwitchModule)}
            className={cn(
              'min-h-11 max-w-full gap-1',
              isCurrent
                ? 'bg-sidebar-primary font-semibold text-sidebar-primary-foreground'
                : SIDEBAR_GHOST_CLASSES,
            )}
          >
            <span className="truncate">{item.label}</span>
            {isCurrent ? (
              <span aria-hidden="true" data-current-marker="" className="size-1.5 shrink-0 rounded-full bg-current" />
            ) : null}
            {isCurrent ? <span className="sr-only">{labels.current}</span> : null}
          </Button>
        );
      })}
    </nav>
  );
}

function MegaMenuContent({
  modules,
  module,
  labels,
  currentModuleId,
  activePageId,
  visiblePageIds,
  onSwitchModule,
  onCloseAutoFocus,
  onSelect,
}: MegaMenuContentProps) {
  const dir = useDirection();
  return (
    <Dialog.Content
      dir={dir}
      aria-modal="true"
      aria-describedby={undefined}
      onCloseAutoFocus={onCloseAutoFocus}
      className="fixed inset-x-2 top-14 z-50 max-h-[min(70vh,32rem)] overflow-y-auto rounded-card bg-card p-4 text-card-foreground shadow-lg min-[1024px]:top-16"
    >
      <div className="mb-4 flex items-center gap-2">
        <Dialog.Title className="text-base font-semibold">{module.label}</Dialog.Title>
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" className="ms-auto" aria-label={labels.close}>
            <XIcon aria-hidden="true" />
          </Button>
        </Dialog.Close>
      </div>
      <ModuleSwitcher
        modules={modules}
        currentModuleId={currentModuleId}
        labels={labels}
        onSwitchModule={onSwitchModule}
      />
      <div className="grid gap-4 min-[700px]:grid-cols-2 min-[1024px]:grid-cols-3">
        {module.href ? (
          <a
            href={module.href}
            onClick={onSelect}
            className={cn(
              'flex min-h-11 items-center rounded-interactive px-3 py-2 text-sm font-medium',
              SIDEBAR_GHOST_CLASSES,
            )}
          >
            {labels.overview}
          </a>
        ) : null}
        {module.sections.map((section) => (
          <MegaMenuSection
            key={section.id}
            section={section}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
            onSelect={onSelect}
          />
        ))}
      </div>
    </Dialog.Content>
  );
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
  const select = () => {
    onNavigate?.();
    onOpenChange(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          aria-current={current ? 'page' : undefined}
          className={cn(
            'min-h-11 gap-1 rounded-none px-3',
            current && 'font-semibold underline decoration-2 underline-offset-4',
          )}
        >
          <span>{module.label}</span>
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
