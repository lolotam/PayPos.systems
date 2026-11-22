'use client';

import { AppSidebarGroup } from './app-sidebar-group.js';
import { AppSidebarItem } from './app-sidebar-item.js';
import type { NavigationGroup } from './navigation-presentation.js';
import { cn } from './shared/cn.js';

type GroupLinkProps = {
  group: NavigationGroup;
  rail: boolean;
  active: boolean;
};

export function CollapsibleGroupLink({ group, rail, active }: GroupLinkProps) {
  return (
    <AppSidebarGroup role="group" aria-label={group.label} className="gap-0">
      <AppSidebarItem
        href={group.href}
        aria-label={rail ? group.label : undefined}
        icon={
          group.icon ?? (
            rail ? (
              <span className="line-clamp-2 break-words text-center text-[10px] leading-tight">
                {group.label}
              </span>
            ) : (
              <span aria-hidden="true" className="size-4" />
            )
          )
        }
        active={active}
        label={
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('truncate', rail && 'sr-only')}>{group.label}</span>
            {group.count ? (
              <span className={cn('rounded-full bg-sidebar-accent px-2 text-xs', rail && 'sr-only')}>
                {group.count}
              </span>
            ) : null}
          </span>
        }
        className={cn(
          'min-h-12',
          rail && 'min-h-15 w-15 justify-center ps-0 pe-0 [&>span:first-child]:hidden',
        )}
      />
    </AppSidebarGroup>
  );
}
