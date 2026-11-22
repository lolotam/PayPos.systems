'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import { ModuleSwitcher } from './mega-menu-module-switcher.js';
import { MegaMenuSection } from './mega-menu-section.js';
import {
  moduleHasVisiblePages,
  onSameTabActivation,
  type NavigationChromeLabels,
  type NavigationModule,
} from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

const OVERVIEW_LINK_CLASSES = cn(
  'flex min-h-11 items-center rounded-interactive px-3 py-2 text-sm font-medium',
  SIDEBAR_GHOST_CLASSES,
);

type MegaMenuContentProps = {
  modules: readonly NavigationModule[];
  module: NavigationModule;
  labels: NavigationChromeLabels;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onSwitchModule: (moduleId: string) => void;
  onCloseAutoFocus?: ((event: Event, moduleId: string) => void) | undefined;
  onSelect: () => void;
};

export function MegaMenuContent({
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
  const visibleModules = modules.filter((item) => moduleHasVisiblePages(item, visiblePageIds));
  const hasVisiblePages = moduleHasVisiblePages(module, visiblePageIds);
  return (
    // السقف = ارتفاع النافذة ناقص شريط الأعلى (56px، و64px من 1024) ناقص هامش سفلي 16px:
    // القائمة تكبر مع الشاشة وتمرّر داخليًا فقط حين تقصر النافذة عن محتواها.
    <Dialog.Content
      dir={dir}
      aria-modal="true"
      aria-describedby={undefined}
      onCloseAutoFocus={(event) => onCloseAutoFocus?.(event, module.id)}
      className="fixed inset-x-2 top-14 z-50 max-h-[calc(100dvh-4.5rem)] overflow-y-auto rounded-card bg-card p-4 text-card-foreground shadow-lg min-[1024px]:top-16 min-[1024px]:max-h-[calc(100dvh-5rem)]"
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
        modules={visibleModules}
        currentModuleId={currentModuleId}
        labels={labels}
        onSwitchModule={onSwitchModule}
      />
      <div className="grid gap-4 min-[700px]:grid-cols-2 min-[1024px]:grid-cols-3">
        {module.href && hasVisiblePages ? (
          <a href={module.href} onClick={onSameTabActivation(onSelect)} className={OVERVIEW_LINK_CLASSES}>
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
