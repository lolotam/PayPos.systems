import type { ComponentProps, ReactNode } from 'react';
import { Card } from './card/card.js';
import { cn } from './shared/cn.js';

export type EmptyStateProps = Omit<ComponentProps<'div'>, 'title'> & {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  className,
  ...props
}: EmptyStateProps) {
  return (
    <Card className={cn('flex flex-col items-center gap-2 p-6 text-center', className)} {...props}>
      <span
        aria-hidden="true"
        className={cn(
          'mb-2 flex size-12 items-center justify-center rounded-interactive bg-secondary',
          tone === 'warning'
            ? 'text-warning'
            : tone === 'danger'
              ? 'text-destructive'
              : 'text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <h2 className="text-lg font-bold">{title}</h2>
      {description ? <p className="max-w-prose text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}
