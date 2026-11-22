import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { cancelledLine, fullLine, linesPage } from '@/my-work/ui/work-fixtures';
import { json } from '@/my-work/ui/work-test-kit';
import {
  EXITS,
  exit,
  gate,
  label,
  mountEntries,
  openScreen,
  opened,
  restoreVisibility,
  serve,
  signIn,
  submitPin,
} from './reception-own-entries-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const pinStep = () => screen.getByLabelText(label('myWork.pinLabel'));
const settle = () => act(() => vi.advanceTimersByTimeAsync(1_000));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  restoreVisibility();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(Object.keys(EXITS))(
  'never shows rows when she leaves the page (%s) before the open answer arrives, and closes that window',
  async (name) => {
    const answer = gate();
    const fetched = serve({
      open: async () => {
        await answer.opened;
        return json(opened('window-late'));
      },
    });
    mountEntries();
    openScreen();
    await submitPin();
    await waitFor(() => expect(fetched.paths('/private-view').length).toBe(1));
    exit(name);
    answer.open();
    await settle();
    expect(screen.queryByText('Haircut')).toBeNull();
    expect(fetched.paths('/service-lines').length).toBe(0);
    expect(pinStep()).toBeTruthy();
    expect(fetched.closes().map((r) => r.headers.get('x-private-view-window-id'))).toEqual([
      'window-late',
    ]);
  },
);

it.each(Object.keys(EXITS))(
  'clears her rows at once when the page is left (%s), aborts the read in flight and never shows its late answer',
  async (name) => {
    const answer = gate();
    const fetched = serve({
      lines: async (request) => {
        if (!new URL(request.url).searchParams.get('cursor'))
          return json(linesPage([fullLine], 'next'));
        await answer.opened;
        return json(linesPage([cancelledLine]));
      },
    });
    mountEntries();
    await signIn();
    fireEvent.click(screen.getByText(label('myWork.loadMore')));
    await waitFor(() => expect(fetched.paths('/service-lines').length).toBe(2));
    const abortsBefore = fetched.aborts();
    exit(name);
    expect(screen.queryByText('Haircut')).toBeNull();
    expect(pinStep()).toBeTruthy();
    expect(screen.getByText(t('en', 'errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
    expect(fetched.aborts()).toBeGreaterThan(abortsBefore);
    await waitFor(() => expect(fetched.closes().length).toBe(1));
    expect(fetched.closes()[0]?.headers.get('x-private-view-window-id')).toBe('window-abc');
    answer.open();
    await settle();
    expect(screen.queryByText('Colour')).toBeNull();
    expect(screen.queryByText('Haircut')).toBeNull();
    expect(fetched.closes().length).toBe(1);
  },
);

it('asks for the PIN again and reads again after any exit, and shows nothing from the old window', async () => {
  const fetched = serve({
    lines: () => json(linesPage([fullLine])),
  });
  mountEntries();
  await signIn();
  exit('tab hidden');
  restoreVisibility();
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(fetched.paths('/service-lines').length).toBe(1);
  await submitPin();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(fetched.paths('/service-lines').length).toBe(2);
  expect(fetched.paths('/private-view').filter((r) => r.method === 'POST').length).toBe(2);
});

it('closes the window, removes every timer and listener, and does nothing afterwards once she leaves the screen', async () => {
  const baseline = vi.getTimerCount();
  const fetched = serve();
  const view = mountEntries();
  await signIn();
  view.unmount();
  await waitFor(() => expect(fetched.closes().length).toBe(1));
  expect(fetched.closes()[0]?.headers.get('x-private-view-window-id')).toBe('window-abc');
  const sent = fetched.requests.length;
  exit('tab hidden');
  fireEvent.keyDown(document.body, { key: 'a' });
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(fetched.requests.length).toBe(sent);
  expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline);
});
