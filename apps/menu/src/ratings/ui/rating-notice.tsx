import { CircleAlert, LoaderCircle } from '@pospay/ui';
import type { ReactNode } from 'react';

type RatingNoticeTone = 'alert' | 'status' | 'loading';

export function RatingNotice({ tone, children }: { tone: RatingNoticeTone; children: ReactNode }) {
  if (tone === 'alert')
    return (
      <p role="alert" className="flex items-start gap-2 text-destructive">
        <CircleAlert aria-hidden="true" className="size-5 shrink-0" />
        <span>{children}</span>
      </p>
    );
  if (tone === 'loading')
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin motion-reduce:animate-none"
        />
        <span>{children}</span>
      </p>
    );
  return (
    <p role="status" className="text-muted-foreground">
      {children}
    </p>
  );
}
