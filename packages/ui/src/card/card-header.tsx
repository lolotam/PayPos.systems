import type { ComponentProps } from 'react';

import { cn } from '../shared/cn.js';

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2 ps-6 pe-6 pt-6', className)} {...props} />;
}
