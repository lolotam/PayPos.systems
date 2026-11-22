'use client';

import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import type { useDirection } from './direction-provider.js';

export type ContextPanelFloatingProps = {
  dir: ReturnType<typeof useDirection>;
  title: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
};

// اللوحة العائمة على التابلت modal حقيقي: Radix هو اللي بيحبس التركيز ويقفل بـ Escape أو بالضغط براها
// ويخفي باقي الصفحة عن قارئ الشاشة. رجوع التركيز بعد القفل بيفضل عند ContextPanel، فبنمنع رجوع Radix.
export function ContextPanelFloating({
  dir,
  title,
  className,
  onClose,
  children,
}: ContextPanelFloatingProps) {
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay data-context-panel-backdrop="" className="fixed inset-0 z-10 bg-black/40" />
        <Dialog.Content
          asChild
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // Escape وسط كتابة IME بيلغي التركيب بس، مش المفروض يقفل اللوحة ويضيّع نص التصفية.
            if (event.isComposing) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <aside dir={dir} aria-modal="true" className={className}>
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {children}
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
