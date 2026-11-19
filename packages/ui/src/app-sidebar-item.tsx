'use client';

import { Slot } from 'radix-ui';
import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
  type ReactElement,
} from 'react';
import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';
import { useDirection } from './direction-provider.js';

export type AppSidebarItemProps = ComponentProps<'a'> & {
  active?: boolean;
  icon: ReactNode;
  label: ReactNode;
  asChild?: boolean;
};

export function AppSidebarItem({
  active = false,
  icon,
  label,
  asChild = false,
  children,
  className,
  ...props
}: AppSidebarItemProps) {
  const dir = useDirection();
  const Component = asChild ? Slot.Root : 'a';
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'absolute start-3 top-1/2 size-1.5 -translate-y-1/2 rounded-full',
          // النقطة بتاخد لون نص الخلفية النشط، وإلا اختفت جوه لون الخلفية نفسه.
          active ? 'bg-sidebar-primary-foreground' : 'bg-transparent',
        )}
      />
      <span aria-hidden="true" className="[&_svg]:size-4">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </>
  );
  return (
    <Component
      dir={dir}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-11 items-center gap-2 rounded-interactive ps-7 pe-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring',
        active
          ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
          : SIDEBAR_GHOST_CLASSES,
        className,
      )}
      {...props}
    >
      {asChild && isValidElement(children)
        ? cloneElement(children as ReactElement<{ children: ReactNode }>, { children: content })
        : content}
    </Component>
  );
}
