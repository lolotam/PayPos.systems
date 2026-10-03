import type { ComponentProps, ReactNode } from 'react';
import { cn } from './shared/cn.js';

export function AppSidebarGroup({
  label,
  children,
  className,
  ...props
}: ComponentProps<'div'> & { label?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      {label ? (
        <p className="px-3 text-xs font-medium text-sidebar-foreground/80">{label}</p>
      ) : null}
      {children}
    </div>
  );
}
