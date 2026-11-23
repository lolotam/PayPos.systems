import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelledLine, fullLine, linesPage, visibleTips } from '@/my-work/ui/work-fixtures';
import { json, renderWork } from '@/my-work/ui/work-test-kit';
import {
  entries,
  exit,
  gate,
  label,
  mountEntries,
  openScreen,
  restoreVisibility,
  serve,
  session,
  signIn,
  submitPin,
} from './reception-own-entries-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const monthOf = (request: Request) => new URL(request.url).searchParams.get('month');
const settle = () => act(() => vi.advanceTimersByTimeAsync(1_000));
const field = () => screen.getByLabelText(label('myWork.pinLabel'));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  restoreVisibility();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('under StrictMode registers each listener once, leaks nothing on unmount, and a second mount still works', async () => {
  const added: string[] = [];
  const removed: string[] = [];
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, ...rest) => {
    added.push(type);
    return add(type, ...(rest as [EventListenerOrEventListenerObject]));
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type, ...rest) => {
    removed.push(type);
    return remove(type, ...(rest as [EventListenerOrEventListenerObject]));
  });
  const baseline = vi.getTimerCount();
  const fetched = serve();
  const view = renderWork(<StrictMode>{entries()}</StrictMode>);
  await signIn();
  const live = (type: string) =>
    added.filter((t) => t === type).length - removed.filter((t) => t === type).length;
  expect(live('visibilitychange')).toBe(1);
  expect(live('freeze')).toBe(1);
  expect(live('keydown')).toBe(1);
  exit('window blur');
  await waitFor(() => expect(fetched.closes().length).toBe(1));
  await settle();
  expect(fetched.closes().length).toBe(1);
  view.unmount();
  expect(live('visibilitychange')).toBe(0);
  expect(live('keydown')).toBe(0);
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline);
  renderWork(<StrictMode>{entries()}</StrictMode>);
  await signIn();
  expect(fetched.paths('/service-lines').length).toBe(2);
});

it('closes, aborts the read in flight and starts from the PIN step when another operator replaces her', async () => {
  const answer = gate();
  const fetched = serve({
    lines: async (request) => {
      if (!new URL(request.url).searchParams.get('cursor'))
        return json(linesPage([fullLine], 'next'));
      await answer.opened;
      return json(linesPage([cancelledLine]));
    },
  });
  const view = mountEntries();
  await signIn();
  fireEvent.click(screen.getByText(label('myWork.loadMore')));
  await waitFor(() => expect(fetched.paths('/service-lines').length).toBe(2));
  const abortsBefore = fetched.aborts();
  view.rerenderWork(entries({ ...session, user_id: '00000000-0000-4000-8000-000000000007' }));
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
  await waitFor(() => expect(fetched.closes().length).toBe(1));
  expect(fetched.aborts()).toBeGreaterThan(abortsBefore);
  answer.open();
  await settle();
  expect(screen.queryByText('Colour')).toBeNull();
  openScreen();
  expect(await screen.findByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(fetched.closes().length).toBe(1);
});

it('keeps only the tips of the month she is on when an older month answers late', async () => {
  let late: (response: Response) => void = () => undefined;
  const started = gate();
  serve({
    lines: (request) => json(linesPage([fullLine], null, monthOf(request) ?? '2026-11')),
    tips: (request) => {
      if (monthOf(request) !== '2026-10') return json({ month: '2026-11', status: 'HIDDEN' });
      started.open();
      return new Promise<Response>((resolve) => (late = resolve));
    },
  });
  mountEntries();
  await signIn();
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  await started.opened;
  fireEvent.click(await screen.findByText(label('myWork.nextMonth')));
  await settle();
  late(json({ ...visibleTips(), month: '2026-10' }));
  await settle();
  expect(screen.queryByText(label('myWork.tipsTitle'))).toBeNull();
  expect(screen.getByText('Haircut')).toBeTruthy();
});

it.each([
  ['an error status', () => json({ code: 'NOT_READY' }, 503)],
  [
    'a network failure',
    (): Response => {
      throw new TypeError('offline');
    },
  ],
])('keeps the PIN step working when the server close fails with %s', async (_, failure) => {
  const fetched = serve({ close: failure });
  mountEntries();
  await signIn();
  exit('tab hidden');
  restoreVisibility();
  await waitFor(() => expect(fetched.closes().length).toBe(1));
  await settle();
  expect(field()).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  await submitPin();
  expect(await screen.findByText('Haircut')).toBeTruthy();
});
