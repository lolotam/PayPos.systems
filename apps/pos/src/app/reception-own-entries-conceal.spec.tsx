import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EXITS,
  exit,
  exitRaw,
  isConcealed,
  label,
  mountEntries,
  restoreVisibility,
  serve,
  signIn,
} from './reception-own-entries-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  restoreVisibility();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(Object.keys(EXITS))(
  'conceals her rows inside the same event dispatch (%s), before any later listener or React flush can see them',
  async (name) => {
    serve();
    mountEntries();
    await signIn();
    const rows = screen.getByText('Haircut');
    expect(isConcealed(rows)).toBe(false);
    const seen: boolean[] = [];
    exitRaw(name, () => seen.push(isConcealed(rows)));
    expect(seen).toEqual([true]);
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(screen.queryByText('Haircut')).toBeNull();
    expect(screen.getByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  },
);

it('conceals her rows inside the timer callback that closes the window at the deadline, and leaves none on the next frame', async () => {
  serve();
  mountEntries();
  await signIn();
  const rows = screen.getByText('Haircut');
  const flag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  flag.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    vi.advanceTimersByTime(60_000);
    expect(isConcealed(rows)).toBe(true);
  } finally {
    flag.IS_REACT_ACT_ENVIRONMENT = true;
  }
  await act(() => vi.advanceTimersByTimeAsync(50));
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(screen.getByLabelText(label('myWork.pinLabel'))).toBeTruthy();
});

it('still unmounts cleanly after her rows were concealed, with no React error and the PIN step in place', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  serve();
  mountEntries();
  await signIn();
  exit('window blur');
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.getByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
