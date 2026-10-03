import type { ComponentProps, ReactNode } from 'react';
import { cn } from './shared/cn.js';

export type PageHeaderProps = Omit<ComponentProps<'header'>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function PageHeader({ title, description, action, className, ...props }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start gap-2 text-start', className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="ms-auto shrink-0">{action}</div> : null}
    </header>
  );
}
