import { expect, it } from 'vitest';
import type { OwnServiceLines } from '@pospay/contracts';
import { reducePrivateWindow, shownMonth, type PrivateWindowState } from './private-window-state';

const page = (month: string, next: string | null = null): OwnServiceLines => ({
  items: [],
  next_cursor: next,
  month,
  time_zone: 'Asia/Kuwait',
});
const deadlines = { sentAt: 0, idleAt: 60_000, capAt: 300_000 };
const open = (): PrivateWindowState =>
  reducePrivateWindow({ phase: 'opening', epoch: 0 }, { type: 'opened', windowId: 'w', deadlines });

it('drops every piece of private data when the window closes and starts empty on the next open', () => {
  let state = open();
  state = reducePrivateWindow(state, { type: 'linesLoaded', page: page('2026-11'), append: false });
  state = reducePrivateWindow(state, {
    type: 'closed',
    problem: 'expired',
    epoch: 1,
    waiting: false,
  });
  expect(state).toEqual({ phase: 'pin', problem: 'expired', epoch: 1, waiting: false });
  const again = reducePrivateWindow(state, { type: 'opened', windowId: 'w2', deadlines });
  expect(again.phase === 'open' && again.data.lines.pages).toEqual([]);
});

it('records the server month as home only for the current-month first page and appends later pages', () => {
  let state = open();
  state = reducePrivateWindow(state, {
    type: 'linesLoaded',
    page: page('2026-11', 'c'),
    append: false,
  });
  state = reducePrivateWindow(state, { type: 'linesLoaded', page: page('2026-11'), append: true });
  if (state.phase !== 'open') throw new Error('not open');
  expect(state.data.home).toBe('2026-11');
  expect(state.data.lines.pages.length).toBe(2);
  expect(shownMonth(state.data)).toBe('2026-11');
  state = reducePrivateWindow(state, { type: 'month', month: '2026-10' });
  if (state.phase !== 'open') throw new Error('not open');
  expect(state.data.lines.status).toBe('pending');
  expect(state.data.home).toBe('2026-11');
  expect(shownMonth(state.data)).toBe('2026-10');
});

it('drops the tips already shown when a retry starts, so a failed tips refresh leaves no old amounts', () => {
  let state = open();
  state = reducePrivateWindow(state, {
    type: 'tipsLoaded',
    tips: { month: '2026-11', status: 'VISIBLE', total_cash: '12.500', total_card: '7.250' },
  });
  state = reducePrivateWindow(state, { type: 'retry' });
  expect(state.phase === 'open' && state.data.tips).toBeUndefined();
  expect(state.phase === 'open' && state.data.lines.status).toBe('pending');
});

it('ignores data actions when no window is open', () => {
  const pin: PrivateWindowState = { phase: 'pin', problem: null, epoch: 0, waiting: false };
  expect(
    reducePrivateWindow(pin, { type: 'linesLoaded', page: page('2026-11'), append: false }),
  ).toBe(pin);
  expect(
    reducePrivateWindow(pin, {
      type: 'touched',
      sentAt: 1,
      remaining: { idle_remaining_ms: 1, cap_remaining_ms: 1 },
    }),
  ).toBe(pin);
});

it('only shortens the cap on a touch and takes the idle time from the server', () => {
  const state = reducePrivateWindow(open(), {
    type: 'touched',
    sentAt: 10_000,
    remaining: { idle_remaining_ms: 60_000, cap_remaining_ms: 900_000 },
  });
  expect(state.phase === 'open' && state.deadlines).toEqual({
    sentAt: 10_000,
    idleAt: 70_000,
    capAt: 300_000,
  });
});

it('lifts the wait without touching the form epoch or the message, and ignores it when nothing waits', () => {
  const waiting: PrivateWindowState = { phase: 'pin', problem: 'expired', epoch: 3, waiting: true };
  expect(reducePrivateWindow(waiting, { type: 'settled' })).toEqual({
    phase: 'pin',
    problem: 'expired',
    epoch: 3,
    waiting: false,
  });
  const idle: PrivateWindowState = { ...waiting, waiting: false };
  expect(reducePrivateWindow(idle, { type: 'settled' })).toBe(idle);
});

it('keeps the form epoch from the PIN step into the opening step', () => {
  const pin: PrivateWindowState = { phase: 'pin', problem: null, epoch: 4, waiting: false };
  expect(reducePrivateWindow(pin, { type: 'opening' })).toEqual({ phase: 'opening', epoch: 4 });
});

it('drops a tips answer for a month other than the shown one and keeps loaded lines when a later page fails', () => {
  let state = reducePrivateWindow(open(), {
    type: 'linesLoaded',
    page: page('2026-11', 'c'),
    append: false,
  });
  state = reducePrivateWindow(state, {
    type: 'tipsLoaded',
    tips: { month: '2026-12', status: 'VISIBLE', total_cash: '1.000', total_card: '1.000' },
  });
  expect(state.phase === 'open' && state.data.tips).toBeUndefined();
  state = reducePrivateWindow(state, { type: 'linesMore' });
  state = reducePrivateWindow(state, { type: 'linesFailed', error: new Error('down') });
  if (state.phase !== 'open') throw new Error('not open');
  expect(state.data.lines.status).toBe('ready');
  expect(state.data.lines.pages.length).toBe(1);
  expect(state.data.lines.moreError).toBeInstanceOf(Error);
});

it('shows the estimate only for the shown month and drops it when the month changes or a retry starts', () => {
  let state = reducePrivateWindow(open(), {
    type: 'linesLoaded',
    page: page('2026-11'),
    append: false,
  });
  state = reducePrivateWindow(state, {
    type: 'estimateLoaded',
    month: '2026-10',
    estimate: { status: 'NO_PLAN', corrections: [] },
  });
  expect(state.phase === 'open' && state.data.estimate).toBeUndefined();
  state = reducePrivateWindow(state, {
    type: 'estimateLoaded',
    month: '2026-11',
    estimate: { status: 'NO_PLAN', corrections: [] },
  });
  expect(state.phase === 'open' && state.data.estimate?.status).toBe('NO_PLAN');
  state = reducePrivateWindow(state, { type: 'retry' });
  expect(state.phase === 'open' && state.data.estimate).toBeUndefined();
  state = reducePrivateWindow(state, {
    type: 'estimateLoaded',
    month: '2026-11',
    estimate: { status: 'NO_PLAN', corrections: [] },
  });
  state = reducePrivateWindow(state, { type: 'month', month: '2026-10' });
  expect(state.phase === 'open' && state.data.estimate).toBeUndefined();
});
