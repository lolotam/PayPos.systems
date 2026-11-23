'use client';

import { onSameTabActivation, type NavigationPage } from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';

export function LocalNavLink({
  page,
  active,
  onNavigate,
}: {
  page: NavigationPage;
  active: boolean;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <li className="shrink-0">
      <a
        href={page.href}
        aria-current={active ? 'page' : undefined}
        onClick={onSameTabActivation(onNavigate)}
        className={cn(
          'flex min-h-11 min-w-11 items-center gap-2 whitespace-nowrap rounded-interactive px-3 py-2 text-sm',
          active
            ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
            : SIDEBAR_GHOST_CLASSES,
        )}
      >
        <span className="truncate">{page.label}</span>
        {page.status ? <span className="text-xs opacity-80">{page.status}</span> : null}
      </a>
    </li>
  );
}
