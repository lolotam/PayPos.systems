import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { json } from '@/my-work/ui/work-test-kit';
import {
  exit,
  gate,
  label,
  mountEntries,
  openScreen,
  opened,
  restoreVisibility,
  serve,
  submitPin,
} from './reception-own-entries-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const field = () => screen.getByLabelText(label('myWork.pinLabel')) as HTMLInputElement;
const send = () => screen.getByText(label('myWork.pinSubmit')) as HTMLButtonElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const settle = () => act(() => vi.advanceTimersByTimeAsync(1_000));
const opens = (fetched: ReturnType<typeof serve>) =>
  fetched.paths('/private-view').filter((request) => request.method === 'POST');

/** فتح بطيء: الرد بيستنى البوابة، فالاختبار يقدر يخرج من الواجهة وهو في الطريق. */
function slowOpen(windowId: string) {
  const answer = gate();
  const fetched = serve({
    open: async () => {
      await answer.opened;
      return json(opened(windowId));
    },
  });
  return { answer, fetched };
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  restoreVisibility();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('empties the PIN field the moment it is sent and cannot send it again after she left, without typing', async () => {
  const { answer, fetched } = slowOpen('window-late');
  mountEntries();
  openScreen();
  await submitPin();
  await waitFor(() => expect(opens(fetched).length).toBe(1));
  expect(field().value).toBe('');
  exit('window blur');
  expect(field().value).toBe('');
  answer.open();
  await settle();
  fireEvent.click(send());
  await settle();
  expect(opens(fetched).length).toBe(1);
  expect(screen.queryByText('Haircut')).toBeNull();
});

it('empties a PIN she was still typing when she leaves the page, in the PIN step itself', async () => {
  serve();
  mountEntries();
  openScreen();
  await screen.findByLabelText(label('myWork.pinLabel'));
  type('43');
  expect(field().value).toBe('43');
  exit('tab hidden');
  expect(field().value).toBe('');
});

it('empties her partly typed PIN on every kind of exit, not only on a hidden tab', async () => {
  serve();
  mountEntries();
  openScreen();
  await screen.findByLabelText(label('myWork.pinLabel'));
  for (const name of ['pagehide', 'freeze', 'resume', 'window blur', 'persisted pageshow']) {
    type('43');
    exit(name);
    expect(field().value, name).toBe('');
  }
});

it('does not let a late answer of the first attempt erase what she types for the next one', async () => {
  const { answer } = slowOpen('window-late');
  mountEntries();
  openScreen();
  await submitPin();
  exit('window blur');
  type('56');
  answer.open();
  await settle();
  expect(field().value).toBe('56');
});

it('shows a wait state and sends no second open while the earlier attempt is unsettled, then works once it settled', async () => {
  const answer = gate();
  let calls = 0;
  const fetched = serve({
    open: async () => {
      calls += 1;
      if (calls === 1) {
        await answer.opened;
        return json(opened('window-a'));
      }
      return json(opened('window-b'));
    },
  });
  mountEntries();
  openScreen();
  await submitPin();
  await waitFor(() => expect(opens(fetched).length).toBe(1));
  exit('tab hidden');
  restoreVisibility();
  expect(screen.getByText(label('myWork.pinWaiting'))).toBeTruthy();
  expect(field().disabled).toBe(true);
  expect(send().disabled).toBe(true);
  fireEvent.click(send());
  fireEvent.submit(field().form as HTMLFormElement);
  await settle();
  expect(opens(fetched).length).toBe(1);
  answer.open();
  await settle();
  expect(screen.queryByText(label('myWork.pinWaiting'))).toBeNull();
  expect(field().disabled).toBe(false);
  await waitFor(() => expect(fetched.closes().length).toBe(1));
  expect(fetched.closes()[0]?.headers.get('x-private-view-window-id')).toBe('window-a');
  await submitPin();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  const order = fetched.requests
    .map((request) => new URL(request.url).pathname)
    .filter((path) => path.includes('/private-view'))
    .map((path) => path.split('/private-view')[1] || '/open');
  expect(order).toEqual(['/open', '/close', '/open']);
});
