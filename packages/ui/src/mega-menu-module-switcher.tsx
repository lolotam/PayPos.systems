'use client';

import type { KeyboardEvent } from 'react';
import { Button } from './button.js';
import type { NavigationChromeLabels, NavigationModule } from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

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

export function ModuleSwitcher({
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
              'min-h-11 min-w-11 max-w-full gap-1',
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
