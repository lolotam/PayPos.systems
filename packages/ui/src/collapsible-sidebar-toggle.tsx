'use client';

import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react/dist/ssr';
import type { Ref } from 'react';
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
};

export function CollapseToggle({
  dir,
  expanded,
  collapseLabel,
  expandLabel,
  toggleRef,
  onToggle,
}: CollapseToggleProps) {
  return (
    <div className="flex shrink-0 items-center justify-end p-2">
      <Button
        ref={toggleRef}
        variant="sidebar"
        size="icon"
        aria-label={expanded ? collapseLabel : expandLabel}
        aria-expanded={expanded}
        onClick={onToggle}
        className="hidden min-[1024px]:inline-flex"
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
