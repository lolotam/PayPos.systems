import type { ComponentProps, ReactNode } from 'react';
import { BrandMark } from './brand-mark.js';
import { Card } from './card/card.js';
import { cn } from './shared/cn.js';

export type BrandedPanelProps = Omit<ComponentProps<'section'>, 'title'> & {
  brandTitle: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  brand?: ReactNode;
};

export function BrandedPanel({
  brandTitle,
  brand,
  title,
  description,
  icon,
  children,
  className,
  ...props
}: BrandedPanelProps) {
  return (
    <section className={cn('mx-auto w-full max-w-lg', className)} {...props}>
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-2 text-start">
          {brand ?? <BrandMark title={brandTitle} className="mb-4 size-16" />}
          {icon ? <span aria-hidden="true">{icon}</span> : null}
          <h1 className="text-2xl font-bold leading-tight">{title}</h1>
          {description ? <p className="text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </Card>
    </section>
  );
}
