import { expect, it } from 'vitest';
import { closeAt, openedDeadlines, touchedDeadlines } from './private-view-deadline';

const remaining = (idle: number, cap: number) => ({
  idle_remaining_ms: idle,
  cap_remaining_ms: cap,
});

it('closes at the earlier of the idle deadline and the absolute cap, counted from the send', () => {
  expect(closeAt(openedDeadlines(1_000, remaining(60_000, 300_000)))).toBe(61_000);
  expect(closeAt(openedDeadlines(1_000, remaining(60_000, 5_000)))).toBe(6_000);
});

it('moves the idle deadline to the server value after a touch but never lets the cap grow', () => {
  const first = openedDeadlines(0, remaining(60_000, 100_000));
  const touched = touchedDeadlines(first, 30_000, remaining(60_000, 200_000));
  expect(touched.idleAt).toBe(90_000);
  expect(touched.capAt).toBe(100_000);
  expect(closeAt(touched)).toBe(90_000);
});

it('lets a short remaining cap in a touch pull the close forward', () => {
  const first = openedDeadlines(0, remaining(60_000, 300_000));
  expect(closeAt(touchedDeadlines(first, 20_000, remaining(60_000, 10_000)))).toBe(30_000);
});

it('ignores the idle value of a touch that was sent before an already confirmed one', () => {
  const first = openedDeadlines(0, remaining(60_000, 300_000));
  const later = touchedDeadlines(first, 40_000, remaining(60_000, 260_000));
  const stale = touchedDeadlines(later, 20_000, remaining(60_000, 280_000));
  expect(stale.idleAt).toBe(100_000);
  expect(stale.sentAt).toBe(40_000);
});

it('also closes 60 seconds after the last input when that is earlier than the confirmed idle deadline', () => {
  const touched = touchedDeadlines(
    openedDeadlines(1_000, remaining(60_000, 300_000)),
    21_000,
    remaining(60_000, 280_000),
  );
  expect(closeAt(touched)).toBe(81_000);
  expect(closeAt(touched, 62_000)).toBe(62_000);
  expect(closeAt(touched, 500_000)).toBe(81_000);
});
