import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PrivateViewWindow } from '@pospay/contracts';
import { WorkHttpError } from '../model/work-error';
import {
  blur,
  build,
  deferred,
  epochOf,
  submit,
  watch,
  window_,
  type Built,
} from './private-window-test-kit';

let current: Built | undefined;
beforeEach(() => void (current = undefined));
afterEach(() => current?.stop());
const make = () => (current = build());

it('sends no second open while an earlier one is unsettled, and sends it only after the stale window was closed', async () => {
  const t = make();
  const log: string[] = [];
  const first = deferred<PrivateViewWindow>();
  t.calls.open.mockImplementationOnce(() => {
    log.push('open a');
    return first.promise;
  });
  t.calls.open.mockImplementationOnce(async () => {
    log.push('open b');
    return window_('wb');
  });
  t.calls.close.mockImplementation(async (id) => void log.push(`close ${id}`));
  void submit(t, '1111');
  blur();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', waiting: true });
  await submit(t, '2222');
  expect(t.calls.open).toHaveBeenCalledTimes(1);
  first.resolve(window_('wa'));
  await t.flush();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', waiting: false });
  await submit(t, '2222');
  expect(log).toEqual(['open a', 'close wa', 'open b']);
  expect(t.controller.getState().phase).toBe('open');
});

it.each([
  ['a wrong PIN', new WorkHttpError('PIN_INVALID', 401)],
  ['a server failure', new WorkHttpError('NOT_READY', 503)],
])(
  'lets her try again once the earlier attempt settled with %s after she left',
  async (_, error) => {
    const t = make();
    const first = deferred<PrivateViewWindow>();
    t.calls.open.mockReturnValueOnce(first.promise);
    void submit(t);
    blur();
    first.reject(error);
    await t.flush();
    expect(t.controller.getState()).toMatchObject({ phase: 'pin', waiting: false });
    await submit(t);
    expect(t.calls.open).toHaveBeenCalledTimes(2);
    expect(t.controller.getState().phase).toBe('open');
  },
);

it('never lets the stale open close or replace the window the later attempt opened', async () => {
  const t = make();
  const first = deferred<PrivateViewWindow>();
  t.calls.open.mockReturnValueOnce(first.promise);
  t.calls.open.mockResolvedValueOnce(window_('wb'));
  void submit(t);
  blur();
  first.resolve(window_('wa'));
  await t.flush();
  await submit(t);
  await t.flush();
  expect(t.calls.close.mock.calls).toEqual([['wa']]);
  expect(t.controller.getState()).toMatchObject({ phase: 'open', windowId: 'wb' });
});

it('ignores a submit that carries the epoch of a form a boundary has invalidated', async () => {
  const t = make();
  const stale = epochOf(t.controller);
  blur();
  expect(epochOf(t.controller)).toBeGreaterThan(stale);
  await t.controller.submitPin('4321', stale);
  expect(t.calls.open).not.toHaveBeenCalled();
  await submit(t);
  expect(t.calls.open).toHaveBeenCalledTimes(1);
});

it('publishes a change on a boundary that happens in the PIN step itself and keeps its message', async () => {
  const t = make();
  const listener = vi.fn();
  t.controller.subscribe(listener);
  const before = t.controller.getState();
  blur();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(t.controller.getState()).not.toBe(before);
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: null });
});

it('keeps the form epoch when the attempt itself failed, so a wrong PIN does not reset the form', async () => {
  const t = make();
  t.calls.open.mockRejectedValueOnce(new WorkHttpError('PIN_INVALID', 401));
  const before = epochOf(t.controller);
  await submit(t);
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'invalid' });
  expect(epochOf(t.controller)).toBe(before);
});

it('does not publish anything to a screen that is already being removed', async () => {
  const t = make();
  await submit(t);
  const watcher = watch(t.controller);
  t.stop();
  blur();
  expect(watcher.seen).toEqual([]);
});
