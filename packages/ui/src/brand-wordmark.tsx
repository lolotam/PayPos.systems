import type { ComponentProps } from 'react';
import { cn } from './shared/cn.js';

export type BrandWordmarkProps = ComponentProps<'span'> & {
  latinName: string;
  arabicName: string;
  tone?: 'ink' | 'light';
};

// TODO(brand): replace with outlined final artwork — النص مؤقت لحد اعتماد المسارات النهائية.
export function BrandWordmark({
  latinName,
  arabicName,
  tone = 'ink',
  className,
  ...props
}: BrandWordmarkProps) {
  return (
    <span
      className={cn(
        'flex flex-col gap-2 font-sans font-bold leading-none',
        tone === 'light' ? 'text-sand-50' : 'text-foreground',
        className,
      )}
      {...props}
    >
      <span lang="en" dir="ltr" className="text-2xl tracking-[-0.02em]">
        {latinName}
      </span>
      <span lang="ar" dir="rtl" className="text-lg">
        {arabicName}
      </span>
    </span>
  );
}
