'use client';

import { useEffect, type RefObject } from 'react';

export function useOutsideDismiss(
  root: RefObject<HTMLDivElement | null>,
  open: boolean,
  dismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [dismiss, open, root]);
}
