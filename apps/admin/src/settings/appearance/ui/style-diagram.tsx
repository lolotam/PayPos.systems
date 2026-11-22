import type { NavigationStyle } from '@/workspace/nav-types';

const BLOCK = 'rounded-sm bg-muted-foreground/30';
const ACCENT = 'rounded-sm bg-primary/70';

/** رسم صغير لشكل الإطار: المقاسات نسبية وزخرفية فقط، واسم النمط ووصفه بجانبه يحملان المعنى. */
export function StyleDiagram({ style }: { style: NavigationStyle }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-20 gap-1 rounded-interactive border border-border p-1"
    >
      {style === 'A' ? (
        <>
          <div className="flex w-1/4 flex-col gap-1">
            <div className={`${ACCENT} h-2`} />
            <div className={`${BLOCK} h-2`} />
            <div className={`${BLOCK} h-2`} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <div className={`${BLOCK} h-2`} />
            <div className={`${BLOCK} flex-1`} />
          </div>
        </>
      ) : null}
      {style === 'B' ? (
        <div className="flex flex-1 flex-col gap-1">
          <div className={`${ACCENT} h-2`} />
          <div className="flex flex-1 gap-1">
            <div className={`${BLOCK} w-1/4`} />
            <div className={`${BLOCK} flex-1`} />
          </div>
        </div>
      ) : null}
      {style === 'C' ? (
        <>
          <div className={`${ACCENT} w-2`} />
          <div className={`${BLOCK} w-1/4`} />
          <div className={`${BLOCK} flex-1`} />
        </>
      ) : null}
    </div>
  );
}
