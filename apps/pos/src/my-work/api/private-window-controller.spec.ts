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

it('requests every later page with the month the first page returned, even when no month was asked for', async () => {
  const t = make();
  t.calls.lines.mockResolvedValueOnce(page('2026-11', 'c1'));
  await submit(t);
  await t.flush();
  expect(t.calls.lines).toHaveBeenLastCalledWith(expect.objectContaining({ month: undefined }));
  t.calls.lines.mockResolvedValueOnce(page('2026-11'));
  t.controller.loadMore();
  await t.flush();
  expect(t.calls.lines).toHaveBeenLastCalledWith(
    expect.objectContaining({ month: '2026-11', cursor: 'c1' }),
  );
});

it('hides the tips already shown when a retry refreshes them and that refresh fails', async () => {
  const t = make();
  const visible = {
    month: '2026-11',
    status: 'VISIBLE',
    total_cash: '12.500',
    total_card: '7.250',
  } as const;
  t.calls.tips.mockResolvedValueOnce(visible);
  await submit(t);
  await t.flush();
  const shown = t.controller.getState();
  expect(shown.phase === 'open' && shown.data.tips).toEqual(visible);
  t.calls.tips.mockRejectedValueOnce(new WorkHttpError('NOT_READY', 503));
  t.controller.retry();
  await t.flush();
  const after = t.controller.getState();
  expect(after.phase === 'open' && after.data.tips).toBeUndefined();
  expect(after.phase === 'open' && after.data.tipsFailed).toBe(true);
});

it('asks for the tips of the month the first lines page returned when no month was asked for', async () => {
  const t = make();
  t.calls.lines.mockResolvedValueOnce(page('2026-11'));
  await submit(t);
  await t.flush();
  expect(t.calls.tips).toHaveBeenCalledTimes(1);
  expect(t.calls.tips).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-11' }));
});

it('retries only the tips after a tips failure and leaves the shown lines alone', async () => {
  const t = make();
  t.calls.tips.mockRejectedValueOnce(new WorkHttpError('NOT_READY', 503));
  await submit(t);
  await t.flush();
  const failed = t.controller.getState();
  expect(failed.phase === 'open' && failed.data.tipsFailed).toBe(true);
  t.controller.retryTips();
  await t.flush();
  const after = t.controller.getState();
  expect(after.phase === 'open' && after.data.tipsFailed).toBe(false);
  expect(after.phase === 'open' && after.data.tips?.status).toBe('HIDDEN');
  expect(t.calls.lines).toHaveBeenCalledTimes(1);
  expect(t.calls.tips).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-11' }));
});
