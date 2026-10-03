import type { ComponentProps, ReactNode } from 'react';
import { Card } from './card/card.js';
import { cn } from './shared/cn.js';

export type DataTableFrameProps = Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode;
  action?: ReactNode;
};

export function DataTableFrame({
  title,
  action,
  children,
  className,
  ...props
}: DataTableFrameProps) {
  return (
    <Card className={cn('min-w-0 overflow-hidden', className)} {...props}>
      {title || action ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          {title ? <h2 className="font-bold">{title}</h2> : null}
          {action ? <div className="ms-auto">{action}</div> : null}
        </div>
      ) : null}
      <div className="overflow-x-auto [&_table]:w-full [&_table]:text-start [&_thead]:bg-secondary [&_th]:px-4 [&_th]:py-3 [&_th]:text-start [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-4 [&_td]:py-3 [&_tbody_tr]:border-t [&_tbody_tr]:border-border">
        {children}
      </div>
    </Card>
  );
}
