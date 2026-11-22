'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';

export type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** اسم الورقة المسمّاة لقارئ الشاشة وعنوانها المرئي؛ من المستدعي مترجمًا. */
  title: string;
  closeLabel: string;
  children: ReactNode;
};

/**
 * ورقة سفلية مودالية فوق الشريط السفلي: تحبس التركيز، وتُغلق بالهروب أو بزر الإغلاق، ويعود التركيز
 * إلى الزر الذي فتحها. الورقة بلا زر فتح خاص بها (يفتحها المستدعي من زر في مكان آخر مثل «المزيد»)،
 * فتحفظ العنصر الذي كان عليه التركيز لحظة الفتح وتعيده عند الإغلاق بدل ترك Radix يردّه إلى لا شيء.
 */
export function BottomSheet({ open, onOpenChange, title, closeLabel, children }: BottomSheetProps) {
  const dir = useDirection();
  const opener = useRef<Element | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          dir={dir}
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current instanceof HTMLElement && opener.current.isConnected) {
              opener.current.focus();
            }
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col overflow-y-auto rounded-t-card border-t border-border bg-card text-card-foreground"
        >
          <div className="flex shrink-0 items-center gap-2 ps-4 pe-2 pt-2">
            <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="ms-auto" aria-label={closeLabel}>
                <XIcon aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="px-4 pb-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
