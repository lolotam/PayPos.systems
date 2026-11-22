import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OwnServiceLines, PrivateViewTouch, PrivateViewWindow } from '@pospay/contracts';
import { WorkHttpError } from '../model/work-error';
import { PrivateWindowController } from './private-window-controller';
import type { PrivateWindowCalls, PrivateWindowEnv } from './private-window-env';

const page = (month = '2026-11'): OwnServiceLines => ({
  items: [],
  next_cursor: null,
  month,
  time_zone: 'Asia/Kuwait',
});
const window_ = (id: string, idle = 60_000, cap = 300_000): PrivateViewWindow => ({
  window_id: id,
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: idle,
  cap_remaining_ms: cap,
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** ساعات يدوية ومؤقتات ما بتشتغلش إلا لما الاختبار يقدّمها، عشان نقدر نخلّي موعد يفوت والمؤقت متأخر. */
function manualEnv() {
  const clock = { mono: 1_000, wall: 1_700_000_000_000 };
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  const env: PrivateWindowEnv = {
    mono: () => clock.mono,
    wall: () => clock.wall,
    online: () => true,
    setTimer: (run, ms) => {
      next += 1;
      timers.set(next, { at: clock.mono + ms, run });
      return next;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
  };
  /** بيقدّم الساعتين معاً، أو الرتيبة بس (`skipTimers`) من غير ما يشغّل المؤقتات: مؤقت اتأخر. */
  const advance = (ms: number, skipTimers = false) => {
    const target = clock.mono + ms;
    while (!skipTimers) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target);
      const first = due.sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      timers.delete(first[0]);
      clock.wall += first[1].at - clock.mono;
      clock.mono = first[1].at;
      first[1].run();
    }
    clock.wall += target - clock.mono;
    clock.mono = target;
  };
  return { env, clock, advance, pending: () => timers.size };
}

function build() {
  const time = manualEnv();
  const calls = {
    open: vi.fn<PrivateWindowCalls['open']>(async () => window_('w1')),
    touch: vi.fn<PrivateWindowCalls['touch']>(async () => ({
      idle_remaining_ms: 60_000,
      cap_remaining_ms: 250_000,
    })),
    close: vi.fn<PrivateWindowCalls['close']>(async () => undefined),
    lines: vi.fn<PrivateWindowCalls['lines']>(async () => page()),
    tips: vi.fn<PrivateWindowCalls['tips']>(async () => ({ month: '2026-11', status: 'HIDDEN' })),
  };
  const onLeave = vi.fn();
  const controller = new PrivateWindowController({ env: time.env, calls }, onLeave);
  const stop = controller.start();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { ...time, calls, onLeave, controller, stop, flush };
}
const phase = (c: PrivateWindowController) => c.visible(c.getState()).phase;
const blur = () => window.dispatchEvent(new Event('blur'));

let current: ReturnType<typeof build> | undefined;
beforeEach(() => void (current = undefined));
afterEach(() => current?.stop());
const make = () => (current = build());

it('discards a read that resolves after the deadline passed even though the timer has not fired yet', async () => {
  const t = make();
  const lines = deferred<OwnServiceLines>();
  t.calls.lines.mockReturnValueOnce(lines.promise);
  await t.controller.submitPin('4321');
  expect(phase(t.controller)).toBe('open');
  t.advance(61_000, true);
  expect(phase(t.controller)).toBe('pin');
  lines.resolve(page());
  await t.flush();
  expect(t.controller.getState().phase).toBe('pin');
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('discards a read that resolves after the window was closed by leaving the page', async () => {
  const t = make();
  const lines = deferred<OwnServiceLines>();
  t.calls.lines.mockReturnValueOnce(lines.promise);
  await t.controller.submitPin('4321');
  blur();
  lines.resolve(page());
  await t.flush();
  expect(t.controller.getState()).toEqual({ phase: 'pin', problem: 'expired' });
});

it('ignores a touch answer that belongs to a closed generation and keeps the new window deadline', async () => {
  const t = make();
  const stale = deferred<PrivateViewTouch>();
  t.calls.touch.mockReturnValueOnce(stale.promise);
  await t.controller.submitPin('4321');
  t.advance(21_000);
  document.dispatchEvent(new Event('keydown'));
  expect(t.calls.touch).toHaveBeenCalledTimes(1);
  blur();
  t.calls.open.mockResolvedValueOnce(window_('w2', 30_000, 30_000));
  await t.controller.submitPin('4321');
  await t.flush();
  const before = t.controller.getState();
  stale.resolve({ idle_remaining_ms: 900_000, cap_remaining_ms: 900_000 });
  await t.flush();
  expect(t.controller.getState()).toBe(before);
  t.advance(31_000);
  expect(phase(t.controller)).toBe('pin');
});

it('moves the deadline only to a successful touch and extends nothing when the touch fails', async () => {
  const t = make();
  await t.controller.submitPin('4321');
  t.calls.touch.mockRejectedValue(new WorkHttpError('NOT_READY', 503));
  t.advance(21_000);
  document.dispatchEvent(new Event('keydown'));
  await t.flush();
  expect(phase(t.controller)).toBe('open');
  t.advance(40_000);
  expect(phase(t.controller)).toBe('pin');
});

it.each([
  ['an hour ahead (sleep)', 3_600_000],
  ['backwards', -10_000],
])('closes when the wall clock moved %s relative to the monotonic one', async (_, jump) => {
  const t = make();
  await t.controller.submitPin('4321');
  t.advance(500);
  t.clock.wall += jump;
  t.advance(600);
  expect(phase(t.controller)).toBe('pin');
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('keeps a window open while both clocks agree and leaves no timer behind once it is closed', async () => {
  const t = make();
  await t.controller.submitPin('4321');
  t.advance(30_000);
  expect(phase(t.controller)).toBe('open');
  blur();
  expect(t.pending()).toBe(0);
});

it('closes on an error thrown while applying a read instead of leaving data on screen', async () => {
  const t = make();
  t.calls.lines.mockResolvedValueOnce(undefined as never);
  await t.controller.submitPin('4321');
  await t.flush();
  expect(t.controller.getState()).toEqual({ phase: 'pin', problem: 'failed' });
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});
