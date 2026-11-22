'use client';

import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { AppSidebarGroup } from './app-sidebar-group.js';
import { AppSidebarItem } from './app-sidebar-item.js';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';
import { groupIsCurrent, visiblePages, type NavigationGroup } from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { useNavigationMedia } from './use-navigation-media.js';

export type CollapsibleSidebarProps = {
  title: string;
  collapseLabel: string;
  expandLabel: string;
  groups: readonly NavigationGroup[];
  currentGroupId?: string | undefined;
  currentPageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  header?: ReactNode;
  footer?: ReactNode;
};

type GroupLinkProps = {
  group: NavigationGroup;
  rail: boolean;
  active: boolean;
};

function CollapsibleGroupLink({ group, rail, active }: GroupLinkProps) {
  return (
    <AppSidebarGroup role="group" aria-label={group.label} className="gap-0">
      <AppSidebarItem
        href={group.href}
        aria-label={rail ? group.label : undefined}
        icon={group.icon ?? <span aria-hidden="true" className="size-4" />}
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

type CollapseToggleProps = {
  dir: ReturnType<typeof useDirection>;
  expanded: boolean;
  collapseLabel: string;
  expandLabel: string;
  toggleRef: Ref<HTMLButtonElement>;
  onToggle: () => void;
};

function CollapseToggle({
  dir,
  expanded,
  collapseLabel,
  expandLabel,
  toggleRef,
  onToggle,
}: CollapseToggleProps) {
  return (
    <div className="flex shrink-0 items-center justify-end p-2">
      <Button
        ref={toggleRef}
        variant="sidebar"
        size="icon"
        aria-label={expanded ? collapseLabel : expandLabel}
        aria-expanded={expanded}
        onClick={onToggle}
        className="hidden min-[1024px]:inline-flex"
      >
        {expanded ? (
          <CaretLeftIcon aria-hidden="true" className={cn('size-4', dir === 'rtl' && 'rotate-180')} />
        ) : (
          <CaretRightIcon aria-hidden="true" className={cn('size-4', dir === 'rtl' && 'rotate-180')} />
        )}
      </Button>
    </div>
  );
}

function useSidebarBreakpointFocus(
  isTablet: boolean,
  asideRef: RefObject<HTMLElement | null>,
  toggleRef: RefObject<HTMLButtonElement | null>,
) {
  const previousTablet = useRef(isTablet);
  useEffect(() => {
    const wasTablet = previousTablet.current;
    if (wasTablet === isTablet) return;
    previousTablet.current = isTablet;
    const active = document.activeElement;
    if (isTablet) {
      if (active === toggleRef.current || asideRef.current?.contains(active)) {
        asideRef.current?.querySelector<HTMLAnchorElement>('nav a[href]')?.focus();
      }
      return;
    }
    if (asideRef.current?.contains(active)) toggleRef.current?.focus();
  }, [asideRef, isTablet, toggleRef]);
}

type SidebarGroupsProps = {
  groups: readonly NavigationGroup[];
  title: string;
  rail: boolean;
  currentGroupId?: string | undefined;
  currentPageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
};

function SidebarGroups({
  groups,
  title,
  rail,
  currentGroupId,
  currentPageId,
  visiblePageIds,
}: SidebarGroupsProps) {
  const shownGroups = groups
    .map((group) => ({ ...group, pages: visiblePages(group.pages, visiblePageIds) }))
    .filter((group) => group.pages.length > 0);
  return (
    <nav aria-label={title} className="flex-1 px-2 pb-4">
      <div className="flex flex-col gap-1">
        {shownGroups.map((group) => (
          <CollapsibleGroupLink
            key={group.id}
            group={group}
            rail={rail}
            active={groupIsCurrent(group, currentGroupId, currentPageId)}
          />
        ))}
      </div>
    </nav>
  );
}

export function CollapsibleSidebar({
  title,
  collapseLabel,
  expandLabel,
  groups,
  currentGroupId,
  currentPageId,
  visiblePageIds,
  header,
  footer,
}: CollapsibleSidebarProps) {
  const dir = useDirection();
  const [expanded, setExpanded] = useState(true);
  const isPhone = useNavigationMedia('(max-width: 599px)');
  const isTablet = useNavigationMedia('(min-width: 600px) and (max-width: 1023px)');
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useSidebarBreakpointFocus(isTablet, asideRef, toggleRef);

  if (isPhone) return null;

  const rail = isTablet || !expanded;
  return (
    <aside
      ref={asideRef}
      dir={dir}
      data-collapsed={rail ? '' : undefined}
      className={cn(
        'fixed inset-y-0 start-0 z-30 hidden flex-col overflow-y-auto bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none min-[600px]:flex',
        rail ? 'w-20' : 'w-66',
      )}
    >
      <CollapseToggle
        dir={dir}
        expanded={expanded}
        collapseLabel={collapseLabel}
        expandLabel={expandLabel}
        toggleRef={toggleRef}
        onToggle={() => setExpanded((value) => !value)}
      />
      {header && !rail ? <div className="shrink-0 p-2">{header}</div> : null}
      <SidebarGroups
        groups={groups}
        title={title}
        rail={rail}
        currentGroupId={currentGroupId}
        currentPageId={currentPageId}
        visiblePageIds={visiblePageIds}
      />
      {footer && !rail ? <div className="shrink-0 p-2">{footer}</div> : null}
    </aside>
  );
}
