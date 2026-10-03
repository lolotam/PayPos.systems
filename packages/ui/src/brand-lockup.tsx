import type { ComponentProps } from 'react';
import { BrandMark } from './brand-mark.js';
import { BrandWordmark } from './brand-wordmark.js';
import { cn } from './shared/cn.js';

export type BrandLockupProps = ComponentProps<'div'> & {
  title: string;
  latinName: string;
  arabicName: string;
  tone?: 'ink' | 'light';
};

export function BrandLockup({
  title,
  latinName,
  arabicName,
  tone = 'ink',
  className,
  ...props
}: BrandLockupProps) {
  return (
    <div
      role="img"
      aria-label={title}
      className={cn('flex items-center gap-3', className)}
      {...props}
    >
      <BrandMark title={title} aria-hidden="true" className="size-14" />
      <BrandWordmark latinName={latinName} arabicName={arabicName} tone={tone} aria-hidden="true" />
    </div>
  );
}
