import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEmployeeListControls } from './use-employee-list-controls';

afterEach(() => {
  vi.useRealTimers();
});

it('holds a typed search while paused and applies it once when resumed', () => {
  vi.useFakeTimers();
  const onSettled = vi.fn();
  const hook = renderHook(({ paused }: { paused: boolean }) => useEmployeeListControls(onSettled, paused), {
    initialProps: { paused: false },
  });
  act(() => {
    hook.result.current.onPage('cursor-1');
    hook.result.current.onSearch('  2  ');
  });
  act(() => {
    hook.rerender({ paused: true });
  });
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(hook.result.current.q).toBeUndefined();
  expect(hook.result.current.cursor).toBe('cursor-1');
  expect(onSettled).not.toHaveBeenCalled();
  act(() => {
    hook.rerender({ paused: false });
  });
  expect(hook.result.current.q).toBe('2');
  expect(hook.result.current.cursor).toBeUndefined();
  expect(onSettled).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(onSettled).toHaveBeenCalledTimes(1);
});
