'use client';

export function ContextPanelBackdrop({ onClose }: { onClose: () => void }) {
  return (
    <div
      aria-hidden="true"
      data-context-panel-backdrop=""
      onClick={onClose}
      className="fixed inset-0 z-10 bg-black/40 min-[1024px]:hidden"
    />
  );
}
