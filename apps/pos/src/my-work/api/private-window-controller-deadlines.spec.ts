import { afterEach, beforeEach, expect, it } from 'vitest';
import type { OwnServiceLines, PrivateViewTouch, PrivateViewWindow } from '@pospay/contracts';
import { TICK_MS } from './private-window-env';
import {
  build,
  deferred,
  keydown,
  page,
  submit,
  watch,
  window_,
  type Built,
} from './private-window-test-kit';

let current: Built | undefined;
beforeEach(() => void (current = undefined));
afterEach(() => current?.stop());
const make = (dropTimer?: (ms: number) => boolean) => (current = build(dropTimer));

/** اللحظة الرتيبة اللي المتحكم بعت فيها إغلاق السيرفر: بتفرّق مؤقت الموعد عن فحص الثانية. */
function closeMoments(t: Built) {
  const moments: number[] = [];
  t.calls.close.mockImplementation(async () => void moments.push(t.clock.mono));
  return moments;
}

it('closes at the exact deadline through its own timer, not at the next one-second check', async () => {
  const t = make();
  const moments = closeMoments(t);
  t.calls.open.mockResolvedValueOnce(window_('w1', 1_350, 300_000));
  await submit(t);
  t.advance(1_349);
  expect(moments).toEqual([]);
  t.advance(1);
  expect(moments).toEqual([2_350]);
});

it('closes through the one-second check when the deadline timer never fires', async () => {
  const t = make((ms) => ms > TICK_MS);
  const moments = closeMoments(t);
  await submit(t);
  t.advance(59_999);
  expect(moments).toEqual([]);
  t.advance(1_001);
  expect(moments).toEqual([61_000]);
  expect(t.pending()).toBe(0);
});

it('turns the store snapshot itself into the PIN step at the deadline, stable by reference, and still notifies when the timer fires', async () => {
  const t = make();
  await submit(t);
  const watcher = watch(t.controller);
  t.advance(61_000, true);
  const first = t.controller.getState();
  expect(first).toMatchObject({ phase: 'pin', problem: 'expired' });
  expect(t.controller.getState()).toBe(first);
  expect(watcher.seen).toEqual([]);
  t.advance(1);
  expect(watcher.seen).toEqual(['pin']);
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('turns the snapshot into the PIN step when the wall clock jumped, before any timer ran', async () => {
  const t = make();
  await submit(t);
  t.clock.wall += 3_600_000;
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
});

it('closes the window from scope() once the deadline passed, and the queued touch never goes out', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  keydown();
  t.advance(61_000, true);
  const watcher = watch(t.controller);
  expect(t.controller.scope(false)).toBeUndefined();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
  expect(watcher.seen).toEqual(['pin']);
  expect(t.calls.touch).not.toHaveBeenCalled();
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('closes without ever publishing the open state when a touch answers with nothing left', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  t.advance(21_000);
  const watcher = watch(t.controller);
  t.calls.touch.mockResolvedValueOnce({ idle_remaining_ms: 0, cap_remaining_ms: 100_000 });
  keydown();
  await t.flush();
  expect(t.calls.close).toHaveBeenCalledWith('w1');
  expect(t.pending()).toBe(0);
  expect(watcher.seen).toEqual(['pin']);
});

it('closes without publishing when a touch answer arrives so late that its own deadline already passed', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  t.advance(21_000);
  const late = deferred<PrivateViewTouch>();
  t.calls.touch.mockReturnValueOnce(late.promise);
  keydown();
  t.advance(25_000, true);
  const watcher = watch(t.controller);
  late.resolve({ idle_remaining_ms: 20_000, cap_remaining_ms: 200_000 });
  await t.flush();
  expect(t.calls.close).toHaveBeenCalledWith('w1');
  expect(t.pending()).toBe(0);
  expect(watcher.seen).toEqual(['pin']);
});

it('closes at once when the open answer itself carries a deadline that already passed', async () => {
  const t = make();
  const slow = deferred<PrivateViewWindow>();
  t.calls.open.mockReturnValueOnce(slow.promise);
  const opening = submit(t);
  t.advance(5_000, true);
  slow.resolve(window_('w1', 4_000, 300_000));
  await opening;
  expect(t.calls.lines).not.toHaveBeenCalled();
  expect(t.calls.close).toHaveBeenCalledWith('w1');
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
  expect(t.pending()).toBe(0);
});

it('closes when the device slept while the open request was in flight', async () => {
  const t = make();
  const slow = deferred<PrivateViewWindow>();
  t.calls.open.mockReturnValueOnce(slow.promise);
  const opening = submit(t);
  t.clock.wall += 3_600_000;
  slow.resolve(window_('w1'));
  await opening;
  expect(t.calls.lines).not.toHaveBeenCalled();
  expect(t.calls.close).toHaveBeenCalledWith('w1');
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
});

it('discards a read that resolves after the device woke, before the one-second check noticed', async () => {
  const t = make();
  const lines = deferred<OwnServiceLines>();
  t.calls.lines.mockReturnValueOnce(lines.promise);
  await submit(t);
  const watcher = watch(t.controller);
  t.clock.wall += 3_600_000;
  lines.resolve(page());
  await t.flush();
  expect(t.calls.close).toHaveBeenCalledWith('w1');
  expect(watcher.seen).toEqual(['pin']);
});

it('discards a touch answer that resolves after the device woke', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  t.advance(21_000);
  const touch = deferred<PrivateViewTouch>();
  t.calls.touch.mockReturnValueOnce(touch.promise);
  keydown();
  t.clock.wall += 3_600_000;
  touch.resolve({ idle_remaining_ms: 60_000, cap_remaining_ms: 200_000 });
  await t.flush();
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});
