import type { ComponentProps } from 'react';
import { cn } from './shared/cn.js';

/** مسار العلامة في الأصول الثابتة؛ نفس الملف اللي بتستخدمه رسالة البريد. */
const BRAND_MARK_SRC = '/brand/logo-mark-simple-tile.png';

export type BrandMarkProps = Omit<ComponentProps<'img'>, 'src' | 'alt'> & {
  title: string;
  alt?: string;
};

export function BrandMark({ title, alt, className, ...props }: BrandMarkProps) {
  // العلامة جوّه الـ lockup بتكون زخرفية: الاسم الميسر جاي من الـ wrapper، فما تتنطقش تاني.
  const decorative = props['aria-hidden'] === true || props['aria-hidden'] === 'true';
  return (
    <img
      src={BRAND_MARK_SRC}
      alt={decorative ? '' : (alt ?? title)}
      width={48}
      height={48}
      className={cn('size-12 shrink-0 rounded-[0.625rem] object-contain', className)}
      {...props}
    />
  );
}
