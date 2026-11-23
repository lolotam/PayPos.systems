import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fullLine, linesPage, visibleTips } from '@/my-work/ui/work-fixtures';
import { json, typeInMyWork } from '@/my-work/ui/work-test-kit';
import {
  gate,
  label,
  mountEntries,
  restoreVisibility,
  serve,
  signIn,
  submitPin,
} from './reception-own-entries-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const forbidden = () => json({ code: 'FORBIDDEN' }, 403);
const cursorOf = (request: Request) => new URL(request.url).searchParams.get('cursor');
const closedWithRefusal = async (fetched: ReturnType<typeof serve>) => {
  expect(await screen.findByText(label('myWork.refused'))).toBeTruthy();
  expect(screen.getByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(screen.queryByText('Colour')).toBeNull();
  await waitFor(() => expect(fetched.closes().length).toBe(1));
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  restoreVisibility();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('closes the window and asks for the PIN again when the first page is forbidden', async () => {
  const fetched = serve({ lines: forbidden });
  mountEntries();
  fireEvent.click(screen.getByRole('button', { name: label('myWork.title') }));
  await submitPin();
  await closedWithRefusal(fetched);
});

it('removes the pages already shown when a later page is forbidden', async () => {
  const fetched = serve({
    lines: (request) => (cursorOf(request) ? forbidden() : json(linesPage([fullLine], 'next'))),
  });
  mountEntries();
  await signIn();
  fireEvent.click(screen.getByText(label('myWork.loadMore')));
  await closedWithRefusal(fetched);
});

it('removes the lines and the tips already shown when the tips are forbidden', async () => {
  const late = gate();
  const fetched = serve({
    tips: async () => {
      await late.opened;
      return forbidden();
    },
  });
  mountEntries();
  await signIn();
  late.open();
  await closedWithRefusal(fetched);
});

it('removes the tips and the lines when an activity touch is forbidden', async () => {
  const fetched = serve({ tips: () => json(visibleTips()), touch: forbidden });
  mountEntries();
  await signIn();
  expect(await screen.findByText(label('myWork.tipsTitle'))).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(21_000));
  typeInMyWork('a');
  await closedWithRefusal(fetched);
  expect(screen.queryByText(label('myWork.tipsTitle'))).toBeNull();
});

it('keeps the window open with a notice when the month is out of range', async () => {
  const fetched = serve({
    lines: (request) =>
      new URL(request.url).searchParams.get('month') === '2026-10'
        ? json({ code: 'MY_PERIOD_OUT_OF_RANGE' }, 422)
        : json(linesPage([fullLine], null, '2026-11')),
  });
  mountEntries();
  await signIn();
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  expect(await screen.findByText(label('myWork.outOfRange'))).toBeTruthy();
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
  expect(fetched.closes().length).toBe(0);
});

it('keeps the window open with a retry when a read fails on the server', async () => {
  const fetched = serve({ lines: () => json({ code: 'NOT_READY' }, 503) });
  mountEntries();
  fireEvent.click(screen.getByRole('button', { name: label('myWork.title') }));
  await submitPin();
  expect(await screen.findByText(label('myWork.failed'))).toBeTruthy();
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
  expect(fetched.closes().length).toBe(0);
});
