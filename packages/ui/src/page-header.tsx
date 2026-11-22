import type { ComponentProps, ReactNode } from 'react';
import { cn } from './shared/cn.js';

export type PageHeaderProps = Omit<ComponentProps<'header'>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  /** إجراءات ثانوية (أزرار outline) تُعرض قبل الإجراء الرئيسي عند الطرف المنطقي. */
  actions?: ReactNode;
  action?: ReactNode;
};

// وصف الترويسة يحمل علامة بيانات يعلّق عليها PageShell سقف 65 حرفًا؛
// الترويسة نفسها لا تقيّد العرض حتى لا تتغير صفحات الـ24 المستخدمة لها اليوم.
export function PageHeader({
  title,
  description,
  actions,
  action,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start gap-2 text-start', className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {description ? (
          <p data-page-header-description className="text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="ms-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
      {action ? <div className="ms-auto shrink-0">{action}</div> : null}
    </header>
  );
}
