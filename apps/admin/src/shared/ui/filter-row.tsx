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

/**
 * حقل داخل صف التصفية: عرض ثابت (14rem) بحد أقصى عرض الصف، وmin-w-0 عشان يتقلص على الجوال.
 * العرض الثابت عشان عنصر الإدخال w-full يتحدد على عرض معروف؛ بدونه ودجت التاريخ والشهر على التابلت ممكن يخرج من
 * صندوق الحقل ويركب على الحقل اللي جنبه.
 */
export function FilterField({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-filter-field=""
      className={cn('grid w-56 max-w-full min-w-0 gap-1', className)}
      {...props}
    />
  );
}
