import type { ComponentProps } from 'react';
import { cn } from './shared/cn.js';

export type BrandMarkProps = Omit<ComponentProps<'svg'>, 'title'> & { title: string };

export function BrandMark({ title, className, ...props }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={cn('size-12 shrink-0', className)}
      {...props}
    >
      <title>{title}</title>
      <rect width="64" height="64" rx="11.52" fill="#FF6421" />
      <path d="M16 12H36C47 12 52 19 52 27S46 42 35 42H27V53H16Z" fill="#0D1522" />
      <circle cx="33" cy="27" r="6.5" fill="#F7F1E8" />
    </svg>
  );
}
