import type { ReactNode } from 'react';

import { FrameBarEnd } from './frame-bar-end';
import { FrameChrome } from './frame-chrome';

/** الشريط العلوي للنمطين A وC: ما في بدايته يعطيه الإطار، والنهاية طرف مشترك يلتف عند ضيق العرض. */
export function FrameTopBar({ start }: { start?: ReactNode }) {
  return (
    <FrameChrome>
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        {start}
        <div className="ms-auto min-w-0">
          <FrameBarEnd />
        </div>
      </header>
    </FrameChrome>
  );
}
