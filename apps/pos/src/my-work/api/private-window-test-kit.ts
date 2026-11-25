import { vi } from 'vitest';
import type { OwnServiceLines, PrivateViewWindow } from '@pospay/contracts';
import { PrivateWindowController } from './private-window-controller';
import type { PrivateWindowCalls, PrivateWindowEnv } from './private-window-env';

export const page = (month = '2026-11', next: string | null = null): OwnServiceLines => ({
  items: [],
  next_cursor: next,
  month,
  time_zone: 'Asia/Kuwait',
});
export const window_ = (id: string, idle = 60_000, cap = 300_000): PrivateViewWindow => ({
  window_id: id,
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: idle,
  cap_remaining_ms: cap,
});

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** ساعات يدوية ومؤقتات ما بتشتغلش إلا لما الاختبار يقدّمها، عشان نقدر نخلّي موعد يفوت والمؤقت متأخر. */
export function manualEnv(dropTimer: (ms: number) => boolean = () => false) {
  const clock = { mono: 1_000, wall: 1_700_000_000_000 };
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  const env: PrivateWindowEnv = {
    mono: () => clock.mono,
    wall: () => clock.wall,
    online: () => true,
    setTimer: (run, ms) => {
      next += 1;
      if (!dropTimer(ms)) timers.set(next, { at: clock.mono + ms, run });
      return next;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
  };
  /** بيقدّم الساعتين معاً، أو من غير ما يشغّل المؤقتات (`skipTimers`): مؤقت اتأخر. */
  const advance = (ms: number, skipTimers = false) => {
    const target = clock.mono + ms;
    while (!skipTimers) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target);
      const first = due.sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      timers.delete(first[0]);
      const at = Math.max(first[1].at, clock.mono);
      clock.wall += at - clock.mono;
      clock.mono = at;
      first[1].run();
    }
    clock.wall += target - clock.mono;
    clock.mono = target;
  };
  return { env, clock, advance, pending: () => timers.size };
}

let currentRoot: HTMLElement | undefined;

export function build(dropTimer?: (ms: number) => boolean) {
  const time = manualEnv(dropTimer);
  const calls = {
    open: vi.fn<PrivateWindowCalls['open']>(async () => window_('w1')),
    touch: vi.fn<PrivateWindowCalls['touch']>(async () => ({
      idle_remaining_ms: 60_000,
      cap_remaining_ms: 250_000,
    })),
    close: vi.fn<PrivateWindowCalls['close']>(async () => undefined),
    lines: vi.fn<PrivateWindowCalls['lines']>(async () => page()),
    tips: vi.fn<PrivateWindowCalls['tips']>(async () => ({ month: '2026-11', status: 'HIDDEN' })),
    commissionEstimate: vi.fn<PrivateWindowCalls['commissionEstimate']>(async () => ({
      status: 'HIDDEN',
    })),
  };
  const onLeave = vi.fn();
  const controller = new PrivateWindowController({ env: time.env, calls }, onLeave);
  const detach = controller.start();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  // حاوية العرض الخاص الحقيقية في المستند: الإدخال بيتحسب بس لو هدفه جواها.
  const root = document.createElement('div');
  document.body.append(root);
  controller.attachRoot(root);
  currentRoot = root;
  const stop = () => {
    detach();
    root.remove();
  };
  return { ...time, calls, onLeave, controller, stop, flush, root };
}
export type Built = ReturnType<typeof build>;

/** نموذج الـ PIN اللي المتحكم بيقبل منه: نفس دورة النموذج الحالية. */
export const epochOf = (controller: PrivateWindowController): number => {
  const state = controller.getState();
  return state.phase === 'pin' || state.phase === 'opening' ? state.epoch : -1;
};
export const submit = (t: Built, pin = '4321') =>
  t.controller.submitPin(pin, epochOf(t.controller));
export const blur = () => window.dispatchEvent(new Event('blur'));
/** إدخال جوّا حاوية العرض الخاص (افتراضياً حاوية آخر `build`) أو في هدف تاني للتجربة. */
export const keydown = (target: EventTarget = currentRoot ?? document) =>
  target.dispatchEvent(new Event('keydown', { bubbles: true }));

/** بيسجّل الحالة المعروضة عند كل إشعار للمشتركين. */
export function watch(controller: PrivateWindowController) {
  const seen: string[] = [];
  const stop = controller.subscribe(() => seen.push(controller.getState().phase));
  return { seen, stop };
}
