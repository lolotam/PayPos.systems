import type { ComponentProps } from 'react';
import { cn } from './shared/cn.js';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'min-h-12 w-full rounded-interactive border border-input bg-card ps-3 pe-3 py-2 text-start text-base text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
