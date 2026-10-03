import type { ComponentProps, ReactNode } from 'react';
import { Card } from './card/card.js';
import { cn } from './shared/cn.js';

export type StatProps = ComponentProps<'div'> & {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
};

export function Stat({ label, value, icon, description, className, ...props }: StatProps) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-2 p-6 text-start', className)} {...props}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <span className="min-w-0 flex-1">{label}</span>
        {icon ? <span aria-hidden="true">{icon}</span> : null}
      </div>
      <p className="break-words text-2xl font-bold tabular-nums">{value}</p>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </Card>
  );
}
