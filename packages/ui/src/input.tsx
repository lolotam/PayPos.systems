import type { ComponentProps } from 'react';

import { cn } from './shared/cn.js';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex min-h-12 w-full rounded-interactive border border-input bg-background ps-3 pe-3 py-2 text-start text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
