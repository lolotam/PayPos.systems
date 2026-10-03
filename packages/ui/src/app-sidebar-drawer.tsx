'use client';
import { Menu, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { Button } from './button.js';
import { useDirection } from './direction-provider.js';

export function AppSidebarDrawer({
  title,
  openLabel,
  closeLabel,
  children,
}: {
  title: string;
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const dir = useDirection();
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={openLabel}>
          <Menu aria-hidden="true" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-950/40" />
        <Dialog.Content
          dir={dir}
          aria-modal="true"
          aria-describedby={undefined}
          className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto bg-sidebar text-sidebar-foreground"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a[href]')) setOpen(false);
          }}
        >
          <div className="flex items-center gap-2 ps-4 pe-2 pt-2">
            <Dialog.Title className="text-sm font-medium">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ms-auto hover:bg-white/10 hover:text-white"
                aria-label={closeLabel}
              >
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
