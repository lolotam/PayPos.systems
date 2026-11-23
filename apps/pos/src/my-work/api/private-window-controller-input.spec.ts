import { afterEach, beforeEach, expect, it } from 'vitest';
import { build, keydown, submit, type Built } from './private-window-test-kit';

let current: Built | undefined;
beforeEach(() => void (current = undefined));
afterEach(() => current?.stop());
const make = () => (current = build());

it('ignores input outside the private view: it neither asks for a touch nor renews the idle deadline', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  t.advance(30_000);
  keydown(document.body);
  await t.flush();
  expect(t.calls.touch).not.toHaveBeenCalled();
  t.advance(30_001);
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('counts input inside the private view and asks for a touch', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  t.advance(30_000);
  keydown();
  await t.flush();
  expect(t.calls.touch).toHaveBeenCalledTimes(1);
  t.advance(30_001);
  expect(t.controller.getState().phase).toBe('open');
});

it('closes 60 seconds after her last input even when the deferred touch moved the server deadline later', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  t.advance(1_000);
  keydown();
  expect(t.calls.touch).not.toHaveBeenCalled();
  t.advance(19_000);
  await t.flush();
  expect(t.calls.touch).toHaveBeenCalledTimes(1);
  t.advance(40_999);
  expect(t.controller.getState().phase).toBe('open');
  t.advance(2);
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
  expect(t.calls.close).toHaveBeenCalledWith('w1');
});

it('does not bring a window back with input that arrives after its idle deadline', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  t.advance(61_000, true);
  keydown();
  await t.flush();
  expect(t.calls.touch).not.toHaveBeenCalled();
  expect(t.controller.getState()).toMatchObject({ phase: 'pin', problem: 'expired' });
});

it('keeps counting each new input: a window with input every 30 seconds stays open', async () => {
  const t = make();
  await submit(t);
  await t.flush();
  for (let step = 0; step < 6; step += 1) {
    t.advance(30_000);
    keydown();
    await t.flush();
  }
  expect(t.controller.getState().phase).toBe('open');
});
