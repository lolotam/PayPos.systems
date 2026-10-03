import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from './shared/cn.js';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border ps-2 pe-2 py-1 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-border bg-secondary text-secondary-foreground',
        neutral: 'border-border bg-secondary text-secondary-foreground',
        brand: 'border-transparent bg-brand-strong text-brand-strong-foreground',
        success: 'border-transparent bg-paid text-status-foreground',
        paid: 'border-transparent bg-paid text-status-foreground',
        warning: 'border-transparent bg-pending text-status-foreground',
        pending: 'border-transparent bg-pending text-status-foreground',
        danger: 'border-transparent bg-failed text-status-foreground',
        failed: 'border-transparent bg-failed text-status-foreground',
        info: 'border-transparent bg-info text-status-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
