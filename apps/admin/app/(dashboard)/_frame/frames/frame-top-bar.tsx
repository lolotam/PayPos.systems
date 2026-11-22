import type { ReactNode } from 'react';

import { FrameActions } from './frame-actions';
import { FrameWorkspaceSwitcher } from './frame-workspace-switcher';

/** الشريط العلوي للنمطين A وC: ما في بدايته يعطيه الإطار، والنهاية مبدّل مساحة العمل وإجراءات الحساب. */
export function FrameTopBar({ start }: { start?: ReactNode }) {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
      {start}
      <div className="ms-auto flex min-w-0 items-center gap-2">
        <FrameWorkspaceSwitcher />
        <FrameActions />
      </div>
    </header>
  );
}
