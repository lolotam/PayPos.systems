'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import { ModuleDrawerSection } from './module-drawer-section.js';
import type { NavigationChromeLabels, NavigationModule } from './navigation-presentation.js';

type DrawerContentProps = {
  modules: readonly NavigationModule[];
  labels: NavigationChromeLabels;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  initialId?: string | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
  onSelect: () => void;
};

export function ModuleDrawerContent({
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
