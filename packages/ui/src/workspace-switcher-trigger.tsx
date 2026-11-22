'use client';

import { CaretDownIcon } from '@phosphor-icons/react/dist/ssr';
import type { ComponentProps } from 'react';

import { Building2 } from './icons.js';
import { cn } from './shared/cn.js';

type WorkspaceSwitcherTriggerProps = ComponentProps<'button'> & {
  businessName: string;
  branchName: string;
};

/**
 * زر مبدّل مساحة العمل: الاسم التجاري والفرع الظاهران كنص، فاسمه المتاح
 * يأتي من محتواه؛ وباقي خصائص الزر تُمرَّر كما هي لأن Radix Slot
 * (عبر `asChild`) يوصل حالة الفتح والمرجع على هذا الزر.
 */
export function WorkspaceSwitcherTrigger({
  businessName,
  branchName,
  className,
  ...props
}: WorkspaceSwitcherTriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-11 w-full items-center gap-2 rounded-interactive border border-input bg-card px-3 py-2 text-start transition-colors motion-reduce:transition-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    >
      <Building2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{businessName}</span>
        <span className="truncate text-xs text-muted-foreground">{branchName}</span>
      </span>
      <CaretDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
