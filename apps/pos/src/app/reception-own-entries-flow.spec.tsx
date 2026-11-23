import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelledLine, fullLine, linesPage, visibleTips } from '@/my-work/ui/work-fixtures';
import { json, typeInMyWork } from '@/my-work/ui/work-test-kit';
import {
  exit,
  gate,
  label,
  mountEntries,
  restoreVisibility,
  serve,
  signIn,
} from './reception-own-entries-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const monthOf = (request: Request | undefined) =>
  new URL(request?.url ?? 'http://x').searchParams.get('month');
const cursorOf = (request: Request | undefined) =>
  new URL(request?.url ?? 'http://x').searchParams.get('cursor');

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  restoreVisibility();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('writes nothing to localStorage or sessionStorage, builds no BroadcastChannel and keeps nothing of hers in the query cache', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const channel = vi.fn();
  vi.stubGlobal('BroadcastChannel', channel);
  serve({
    lines: (request) =>
      json(
        cursorOf(request)
          ? linesPage([cancelledLine])
          : linesPage([fullLine], 'next', monthOf(request) ?? '2026-11'),
      ),
    tips: () => json(visibleTips()),
  });
  const view = mountEntries();
  await signIn();
  expect(await screen.findByText(label('myWork.tipsTitle'))).toBeTruthy();
  fireEvent.click(screen.getByText(label('myWork.loadMore')));
  expect(await screen.findByText('Colour')).toBeTruthy();
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  await waitFor(() => expect(screen.getByText('October 2026')).toBeTruthy());
  typeInMyWork('a');
  await act(() => vi.advanceTimersByTimeAsync(25_000));
  exit('tab hidden');
  expect(setItem).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(channel).not.toHaveBeenCalled();
  expect(view.client.getQueryCache().getAll().length).toBe(0);
});

it('loads the next page by cursor through the controller and then hides the load-more button', async () => {
  const fetched = serve({
    lines: (request) =>
      json(cursorOf(request) ? linesPage([cancelledLine]) : linesPage([fullLine], 'page-2')),
  });
  mountEntries();
  await signIn();
  fireEvent.click(screen.getByText(label('myWork.loadMore')));
  expect(await screen.findByText('Colour')).toBeTruthy();
  expect(screen.getByText('Haircut')).toBeTruthy();
  expect(cursorOf(fetched.paths('/service-lines')[1])).toBe('page-2');
  expect(screen.queryByText(label('myWork.loadMore'))).toBeNull();
});

it('steps back a month through the controller with the server month as the start and never forward past it', async () => {
  const fetched = serve({
    lines: (request) => {
      const month = monthOf(request);
      return json(
        month === '2026-10'
          ? linesPage([cancelledLine], null, '2026-10')
          : linesPage([fullLine], null, '2026-11'),
      );
    },
  });
  mountEntries();
  await signIn();
  const next = () => screen.getByText(label('myWork.nextMonth')) as HTMLButtonElement;
  expect(next().disabled).toBe(true);
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  expect(await screen.findByText('Colour')).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(monthOf(fetched.paths('/service-lines')[1])).toBe('2026-10');
  expect(monthOf(fetched.paths('/tips')[1])).toBe('2026-10');
  expect(next().disabled).toBe(false);
  fireEvent.click(next());
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(next().disabled).toBe(true);
});

it('keeps only the answer of the month she is on when an older month answers late', async () => {
  let late: (response: Response) => void = () => undefined;
  const started = gate();
  serve({
    lines: (request) => {
      if (monthOf(request) !== '2026-10') return json(linesPage([fullLine], null, '2026-11'));
      started.open();
      return new Promise<Response>((resolve) => (late = resolve));
    },
  });
  mountEntries();
  await signIn();
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  await started.opened;
  fireEvent.click(await screen.findByText(label('myWork.nextMonth')));
  expect(await screen.findByText('Haircut')).toBeTruthy();
  late(json(linesPage([cancelledLine], null, '2026-10')));
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(screen.queryByText('Colour')).toBeNull();
  expect(screen.getByText('Haircut')).toBeTruthy();
});
