import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkHttpError } from '../model/work-error';
import { build, keydown, page, submit, type Built } from './private-window-test-kit';

let current: Built | undefined;
beforeEach(() => void (current = undefined));
afterEach(() => current?.stop());
const make = () => (current = build());

const forbidden = () => new WorkHttpError('FORBIDDEN', 403);
const pinStep = (t: Built) => t.controller.getState();

it.each([
  ['FORBIDDEN', new WorkHttpError('FORBIDDEN', 403)],
  ['an authorization shape nobody listed', new WorkHttpError('SOMETHING_ELSE', 403)],
])(
  'closes the whole window with the refused message when the first page answers 403 %s',
  async (_, error) => {
    const t = make();
    t.calls.lines.mockRejectedValueOnce(error);
    await submit(t);
    await t.flush();
    expect(pinStep(t)).toMatchObject({ phase: 'pin', problem: 'refused' });
    expect(t.calls.close).toHaveBeenCalledWith('w1');
  },
);

it('clears pages already loaded when a later cursor page answers 403 FORBIDDEN', async () => {
  const t = make();
  t.calls.lines.mockResolvedValueOnce(page('2026-11', 'next'));
  await submit(t);
  await t.flush();
  expect(pinStep(t).phase).toBe('open');
  t.calls.lines.mockRejectedValueOnce(forbidden());
  t.controller.loadMore();
  await t.flush();
  expect(pinStep(t)).toMatchObject({ phase: 'pin', problem: 'refused' });
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('clears the lines already shown when the tips answer 403 FORBIDDEN', async () => {
  const t = make();
  t.calls.tips.mockRejectedValueOnce(forbidden());
  await submit(t);
  await t.flush();
  expect(pinStep(t)).toMatchObject({ phase: 'pin', problem: 'refused' });
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('closes the window when an activity touch answers 403 FORBIDDEN', async () => {
  const t = make();
  await submit(t);
  t.advance(21_000);
  t.calls.touch.mockRejectedValueOnce(forbidden());
  keydown();
  await t.flush();
  expect(pinStep(t)).toMatchObject({ phase: 'pin', problem: 'refused' });
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('leaves the screen on any 401 from a read or a touch, whatever its code', async () => {
  const t = make();
  t.calls.lines.mockRejectedValueOnce(new WorkHttpError('PIN_INVALID', 401));
  await submit(t);
  await t.flush();
  expect(pinStep(t).phase).toBe('leave');
  expect(t.onLeave).toHaveBeenCalledTimes(1);
});

it('keeps the window open with an in-window notice for an out-of-range month', async () => {
  const t = make();
  t.calls.lines.mockRejectedValueOnce(new WorkHttpError('MY_PERIOD_OUT_OF_RANGE', 422));
  await submit(t);
  await t.flush();
  const state = pinStep(t);
  expect(state.phase === 'open' && state.data.lines.status).toBe('error');
  expect(t.calls.close).not.toHaveBeenCalled();
});

it('keeps the window and its deadline for a server failure on a read or a touch', async () => {
  const t = make();
  t.calls.lines.mockRejectedValueOnce(new WorkHttpError('NOT_READY', 503));
  await submit(t);
  await t.flush();
  const state = pinStep(t);
  expect(state.phase === 'open' && state.data.lines.status).toBe('error');
  const deadlines = state.phase === 'open' ? state.deadlines : undefined;
  t.advance(21_000);
  t.calls.touch.mockRejectedValueOnce(new WorkHttpError('NOT_READY', 503));
  keydown();
  await t.flush();
  const after = pinStep(t);
  expect(after.phase === 'open' && after.deadlines).toEqual(deadlines);
  expect(t.calls.close).not.toHaveBeenCalled();
});
