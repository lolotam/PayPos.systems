'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps, MouseEvent } from 'react';

import { cn } from './shared/cn.js';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-interactive text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'min-h-11 ps-3 pe-3 py-2',
        md: 'min-h-12 ps-4 pe-4 py-2',
        lg: 'min-h-14 ps-6 pe-6 py-3',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

// A slotted link ignores the `disabled` attribute, so it is disabled the way ARIA expects: announced, out of the
// tab order, and its activation (click or Enter) cancelled.
const cancelActivation = (event: MouseEvent<HTMLElement>) => {
  event.preventDefault();
  event.stopPropagation();
};

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  disabled,
  onClick,
  tabIndex,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (!asChild) {
    return (
      <button
        type={type ?? 'button'}
        disabled={disabled}
        onClick={onClick}
        tabIndex={tabIndex}
        className={classes}
        {...props}
      />
    );
  }
  return (
    <Slot.Root
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? '' : undefined}
      tabIndex={disabled ? -1 : tabIndex}
      onClick={disabled ? cancelActivation : onClick}
      className={classes}
      {...props}
    />
  );
}
