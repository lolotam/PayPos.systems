'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
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
  module: NavigationModule;
  labels: NavigationChromeLabels;
  open: boolean;
  current?: boolean | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onOpenChange: (open: boolean) => void;
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

type MegaMenuContentProps = Omit<MegaMenuProps, 'open' | 'onOpenChange'> & {
  onSelect: () => void;
};

function MegaMenuContent({
  module,
  labels,
  activePageId,
  visiblePageIds,
  onSelect,
}: MegaMenuContentProps) {
  const dir = useDirection();
  return (
    <Dialog.Content
      dir={dir}
      aria-modal="true"
      aria-describedby={undefined}
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
  module,
  labels,
  open,
  current = false,
  activePageId,
  visiblePageIds,
  onOpenChange,
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
          variant="ghost"
          size="sm"
          aria-current={current ? 'page' : undefined}
          className="min-h-11 gap-1 rounded-none px-3"
        >
          <span>{module.label}</span>
          <span className="sr-only">{labels.openMenu}</span>
        </Button>
      </Dialog.Trigger>
      {open ? (
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <MegaMenuContent
            module={module}
            labels={labels}
            activePageId={activePageId}
            visiblePageIds={visiblePageIds}
            onSelect={select}
          />
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}
