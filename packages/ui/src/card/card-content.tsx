import type { ComponentProps } from 'react';

import { cn } from '../shared/cn.js';

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ps-6 pe-6 py-6', className)} {...props} />;
}
