import type { ComponentProps } from 'react';

import { cn } from '../shared/cn.js';

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-start text-lg font-bold leading-tight', className)} {...props} />;
}
