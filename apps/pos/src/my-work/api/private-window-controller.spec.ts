import { afterEach, beforeEach, expect, it } from 'vitest';
import type { OwnServiceLines, PrivateViewTouch } from '@pospay/contracts';
import { WorkHttpError } from '../model/work-error';
import type { PrivateWindowController } from './private-window-controller';
import {
  blur,
  build,
  deferred,
  keydown,
  page,
  submit,
  window_,
  type Built,
} from './private-window-test-kit';

const phase = (c: PrivateWindowController) => c.getState().phase;

let current: Built | undefined;
beforeEach(() => void (current = undefined));
afterEach(() => current?.stop());
const make = () => (current = build());

it('discards a read that resolves after the deadline passed even though the timer has not fired yet', async () => {
  const t = make();
  const lines = deferred<OwnServiceLines>();
  t.calls.lines.mockReturnValueOnce(lines.promise);
  await submit(t);
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
  await submit(t);
  blur();
  lines.resolve(page());
  await t.flush();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
});

it('ignores a touch answer that belongs to a closed generation and keeps the new window deadline', async () => {
  const t = make();
  const stale = deferred<PrivateViewTouch>();
  t.calls.touch.mockReturnValueOnce(stale.promise);
  await submit(t);
  t.advance(21_000);
  keydown();
  expect(t.calls.touch).toHaveBeenCalledTimes(1);
  blur();
  t.calls.open.mockResolvedValueOnce(window_('w2', 30_000, 30_000));
  await submit(t);
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
  await submit(t);
  t.calls.touch.mockRejectedValue(new WorkHttpError('NOT_READY', 503));
  t.advance(21_000);
  keydown();
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
  await submit(t);
  t.advance(500);
  t.clock.wall += jump;
  t.advance(600);
  expect(phase(t.controller)).toBe('pin');
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('keeps a window open while both clocks agree and leaves no timer behind once it is closed', async () => {
  const t = make();
  await submit(t);
  t.advance(30_000);
  expect(phase(t.controller)).toBe('open');
  blur();
  expect(t.pending()).toBe(0);
});

it('closes on an error thrown while applying a read instead of leaving data on screen', async () => {
  const t = make();
  t.calls.lines.mockResolvedValueOnce(undefined as never);
  await submit(t);
  await t.flush();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'failed' });
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('keeps the PIN step usable when the server close fails', async () => {
  const t = make();
  t.calls.close.mockRejectedValue(new Error('network down'));
  await submit(t);
  blur();
  await t.flush();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
  t.calls.close.mockResolvedValue(undefined);
  await submit(t);
  expect(phase(t.controller)).toBe('open');
});
