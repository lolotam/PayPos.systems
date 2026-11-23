'use client';

import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { Dialog } from 'radix-ui';
import { useRef, type ReactNode, type RefObject } from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';

export type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** اسم الورقة المسمّاة لقارئ الشاشة وعنوانها المرئي؛ من المستدعي مترجمًا. */
  title: string;
  closeLabel: string;
  /** الزر الذي فتح الورقة بحسب المستدعي؛ إليه يعود التركيز عند الإغلاق. الغياب يعيده إلى ما كان عليه التركيز لحظة الفتح. */
  openerRef?: RefObject<HTMLElement | null> | undefined;
  /** يُستدعى لحظة الإغلاق ويعيد العنصر الذي يأخذ التركيز بدل الفتّاح، كأن يكون الفتّاح قد اختفى بتغيّر العرض؛ لا شيء يعني الفتّاح. */
  closeFocusTarget?: (() => HTMLElement | null | undefined) | undefined;
  children: ReactNode;
};

/**
 * ورقة سفلية مودالية فوق الشريط السفلي: تحبس التركيز، وتُغلق بالهروب أو بزر الإغلاق، ويعود التركيز
 * إلى الزر الذي فتحها. الورقة بلا زر فتح خاص بها (يفتحها المستدعي من زر في مكان آخر مثل «المزيد»)،
 * فيعطيها المستدعي ذلك الزر في openerRef. ما كان عليه التركيز لحظة الفتح لا يصلح وحده بديلًا لأن
 * الضغط قد لا ينقل التركيز إلى الزر فيعود إلى حقل آخر.
 * التركيز الذي انتقل فعلًا إلى عنصر خارج الورقة (صفحة وصلت أثناء الإغلاق بالتنقّل) يبقى مكانه؛ الإغلاق بالهروب
 * أو بالغطاء يُسقط التركيز على body فيعود إلى الفتّاح.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  openerRef,
  closeFocusTarget,
  children,
}: BottomSheetProps) {
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
            const active = document.activeElement;
            if (active !== null && active !== document.body) return;
            const target = closeFocusTarget?.() ?? openerRef?.current ?? opener.current;
            if (target instanceof HTMLElement && target.isConnected) target.focus();
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
