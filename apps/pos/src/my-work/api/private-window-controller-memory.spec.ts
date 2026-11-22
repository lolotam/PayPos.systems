import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PrivateViewWindow } from '@pospay/contracts';
import { OPEN_TIMEOUT_MS } from './private-window-env';
import { windowShell } from './use-private-window';
import {
  blur,
  build,
  deferred,
  page,
  submit,
  window_,
  type Built,
} from './private-window-test-kit';

let current: Built | undefined;
beforeEach(() => void (current = undefined));
afterEach(() => current?.stop());
const make = () => (current = build());

/** بيدوّر في حقول المتحكم نفسه (من غير الاستدعاءات المحقونة) على مرجع لكائن معيّن. */
function holds(root: object, needle: object): boolean {
  const seen = new Set<object>();
  const walk = (value: unknown): boolean => {
    if (value === needle) return true;
    if (typeof value !== 'object' || value === null || seen.has(value)) return false;
    seen.add(value);
    return Object.entries(value).some(([key, inner]) => key !== 'deps' && walk(inner));
  };
  return walk(root);
}

it('keeps no reference to her rows after a snapshot was read past the deadline and the timer then closed', async () => {
  const t = make();
  const rows = { ...page(), items: [] as never[] };
  t.calls.lines.mockImplementation(async () => rows);
  await submit(t);
  await t.flush();
  expect(holds(t.controller, rows)).toBe(true);
  t.advance(61_000, true);
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
  t.advance(1);
  expect(t.calls.close).toHaveBeenCalledWith('w1');
  expect(holds(t.controller, rows)).toBe(false);
});

it('aborts the signal of the read in flight when the page is left', async () => {
  const t = make();
  const pending = deferred<ReturnType<typeof page>>();
  let signal: AbortSignal | undefined;
  t.calls.lines.mockImplementation((read) => {
    signal = read.signal;
    return pending.promise;
  });
  await submit(t);
  expect(signal?.aborted).toBe(false);
  blur();
  expect(signal?.aborted).toBe(true);
});

it('reopens the form once a stale open answered, without waiting for its server close', async () => {
  const t = make();
  const first = deferred<PrivateViewWindow>();
  t.calls.open.mockImplementationOnce(() => first.promise);
  t.calls.close.mockImplementation(() => new Promise<void>(() => undefined));
  void submit(t, '1111');
  blur();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', waiting: true });
  first.resolve(window_('wa'));
  await t.flush();
  expect(t.calls.close).toHaveBeenCalledWith('wa');
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', waiting: false });
  await submit(t, '2222');
  expect(t.calls.open).toHaveBeenCalledTimes(2);
});

it('cancels an open that never answers after the limit and lets her try again', async () => {
  const t = make();
  let signal: AbortSignal | undefined;
  t.calls.open.mockImplementationOnce(
    (_pin, stop) =>
      new Promise<PrivateViewWindow>((_resolve, reject) => {
        signal = stop;
        stop?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  void submit(t, '1111');
  t.advance(OPEN_TIMEOUT_MS - 1);
  expect(signal?.aborted).toBe(false);
  expect(t.controller.getState()).toMatchObject({ phase: 'opening' });
  t.advance(1);
  await t.flush();
  expect(signal?.aborted).toBe(true);
  expect(t.controller.getState()).toMatchObject({
    phase: 'pin',
    problem: 'failed',
    waiting: false,
  });
  await submit(t, '2222');
  expect(t.calls.open).toHaveBeenCalledTimes(2);
  expect(t.controller.getState()).toMatchObject({ phase: 'open' });
});

it('gives the always-mounted screen a snapshot of the open window that carries none of her data', async () => {
  const t = make();
  const rows = { ...page(), items: [] as never[] };
  t.calls.lines.mockImplementation(async () => rows);
  const shell = windowShell(t.controller);
  await submit(t);
  await t.flush();
  const open = shell();
  expect(open).toEqual({ phase: 'open' });
  expect(shell()).toBe(open);
  expect(holds(open, rows)).toBe(false);
  blur();
  expect(shell()).toMatchObject({ phase: 'pin', problem: 'expired' });
});

it('frees the form at the limit even when the open call ignores the abort, and closes a window that opens late', async () => {
  const t = make();
  const stalled = deferred<PrivateViewWindow>();
  t.calls.open.mockImplementationOnce(() => stalled.promise);
  void submit(t, '1111');
  t.advance(OPEN_TIMEOUT_MS);
  await t.flush();
  expect(t.controller.getState()).toMatchObject({
    phase: 'pin',
    problem: 'failed',
    waiting: false,
  });
  stalled.resolve(window_('late'));
  await t.flush();
  expect(t.calls.close).toHaveBeenCalledWith('late');
  expect(t.controller.getState()).toMatchObject({ phase: 'pin' });
});
