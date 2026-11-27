'use client';

import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode, Ref } from 'react';
import { Button } from './button.js';
import type { useDirection } from './direction-provider.js';
import { cn } from './shared/cn.js';

type CollapseToggleProps = {
  dir: ReturnType<typeof useDirection>;
  expanded: boolean;
  collapseLabel: string;
  expandLabel: string;
  toggleRef: Ref<HTMLButtonElement>;
  onToggle: () => void;
  /** محتوى رأس الشريط — يُرسم في نفس صف مبدّل الطي، وغيابه يعني صفًا بلا شعار. */
  header?: ReactNode;
};

// ارتفاع 60px محجوز من 1024px فقط: الشريط المطويّ على التابلت صف فارغ بلا رأس، فحجزه
// فيه يضيّع شريطًا كاملًا من الشاشة بلا فائدة.
export function CollapseToggle({
  dir,
  expanded,
  collapseLabel,
  expandLabel,
  toggleRef,
  onToggle,
  header,
}: CollapseToggleProps) {
  return (
    <div className="relative flex shrink-0 items-center justify-center p-2 min-[1024px]:min-h-15">
      {expanded ? header : null}
      <Button
        ref={toggleRef}
        variant="sidebar"
        size="icon"
        aria-label={expanded ? collapseLabel : expandLabel}
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'hidden min-[1024px]:inline-flex',
          expanded && 'end-2 min-[1024px]:absolute',
        )}
      >
        {expanded ? (
          <CaretLeftIcon aria-hidden="true" className={cn('size-4', dir === 'rtl' && 'rotate-180')} />
        ) : (
          <CaretRightIcon aria-hidden="true" className={cn('size-4', dir === 'rtl' && 'rotate-180')} />
        )}
      </Button>
    </div>
  );
}
