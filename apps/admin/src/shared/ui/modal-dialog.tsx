'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

export function ModalDialog({
  title,
  pending = false,
  onClose,
  className,
  children,
}: {
  title: string;
  pending?: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className={`m-auto max-h-[90vh] w-full ${className ?? 'max-w-xl'} overflow-auto rounded-xl border border-border bg-card p-6 text-card-foreground backdrop:bg-black/40`}
    >
      <div className="flex flex-col gap-4 text-start">
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
