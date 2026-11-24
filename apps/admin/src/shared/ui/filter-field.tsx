import { cn } from '@pospay/ui';
import type { ComponentProps } from 'react';

/**
 * حقل داخل صف التصفية: عرض ثابت (14rem) بحد أقصى عرض الصف، وmin-w-0 عشان يتقلص على الجوال.
 * عمود الشبكة minmax(0,1fr) مش auto، وعنصر الإدخال والقائمة min-w-0 max-w-full: ودجت التاريخ والشهر على التابلت
 * عرضه الأدنى الطبيعي كان ممكن يوسّع العمود فوق الـ14rem ويركب على الحقل اللي جنبه.
 */
export function FilterField({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-filter-field=""
      className={cn(
        'grid w-56 max-w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-1 [&_input]:max-w-full [&_input]:min-w-0 [&_select]:max-w-full [&_select]:min-w-0',
        className,
      )}
      {...props}
    />
  );
}
