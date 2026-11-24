import { cn } from '@pospay/ui';
import type { ComponentProps } from 'react';

/** صف تصفية: يلتف على سطر ثانٍ بدل ما تتزاحم الحقول، بفجوة ثابتة بين الحقول وبين الأسطر. */
export function FilterRow({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-filter-row=""
      className={cn('flex flex-wrap items-end gap-x-4 gap-y-3', className)}
      {...props}
    />
  );
}
