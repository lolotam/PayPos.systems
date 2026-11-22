import { vi } from 'vitest';
import { openedDeadlines } from '../model/private-view-deadline';
import { claimSharedKey } from '../model/private-view-key';
import { type ClockHandlers, startPrivateViewClock } from './private-view-clock';

export const WALL0 = 1_700_000_000_000;
export const remaining = { idle_remaining_ms: 60_000, cap_remaining_ms: 300_000 };

/** تاب واحد: ساعتين بيتحركوا بإيدينا، وردود فعل مراقَبة، ومفتاح مشترك اتكتب بالفتح (إلا لو `writeKey: false`). */
export function openTab(options: { windowId?: string; writeKey?: boolean } = {}) {
  const windowId = options.windowId ?? 'win-a';
  const clock = { mono: 0, wall: WALL0 };
  const handlers = {
    hide: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    refused: vi.fn(),
  } satisfies ClockHandlers;
  if (options.writeKey ?? true)
    claimSharedKey(
      {
        windowId,
        sessionRef: 'session-1',
        windowSeq: '1',
        idleWallAt: WALL0 + remaining.idle_remaining_ms,
        capWallAt: WALL0 + remaining.cap_remaining_ms,
      },
      WALL0,
    );
  const handle = startPrivateViewClock(
    {
      windowId,
      deadlines: openedDeadlines(0, remaining),
      sentWall: WALL0,
    },
    handlers,
    { mono: () => clock.mono, wall: () => clock.wall },
  );
  return {
    clock,
    handlers,
    stop: handle.stop,
    epoch: handle.epoch,
    fence: handle.fence,
    isCurrent: handle.isCurrent,
  };
}

export const visibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};
export const pageshow = (persisted: boolean) =>
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
export const elapse = (tab: ReturnType<typeof openTab>, ms: number) => {
  tab.clock.mono += ms;
  tab.clock.wall += ms;
};

export class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all)
      if (other !== this && !other.closed) other.onmessage?.({ data } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}
