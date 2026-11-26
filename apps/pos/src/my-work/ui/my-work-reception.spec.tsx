import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import { fullLine, hiddenTips, linesPage } from './work-fixtures';
import {
  installFetch,
  json,
  myWorkEntries,
  pointInMyWork,
  renderWork,
  replaceFetch,
  type Route,
  typeInMyWork,
} from './work-test-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const WINDOW = 'window-abc';
const PIN = '4321';
const context: WorkContext = { mode: 'reception', identity: '0:sara:device:2026-12-01' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const window_ = {
  window_id: WINDOW,
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: 60_000,
  cap_remaining_ms: 300_000,
};
type Overrides = { open?: Route; lines?: Route; touch?: Route };

function serve(overrides: Overrides = {}) {
  return installFetch((request, url) => {
    if (url.pathname.endsWith('/private-view/touch'))
      return (
        overrides.touch?.(request, url) ??
        json({ idle_remaining_ms: 60_000, cap_remaining_ms: 250_000 })
      );
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view'))
      return overrides.open?.(request, url) ?? json(window_);
    if (url.pathname.endsWith('/service-lines'))
      return overrides.lines?.(request, url) ?? json(linesPage([fullLine]));
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    return undefined;
  });
}
const open = (onLeave: () => void = () => undefined) =>
  renderWork(<MyWorkScreen context={context} onLeave={onLeave} />);
const enterPin = async (pin = PIN) => {
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: pin },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
};
const signIn = async () => {
  await enterPin();
  expect(await screen.findByText('Haircut')).toBeTruthy();
};
const touches = (fetched: ReturnType<typeof serve>) => fetched.paths('/private-view/touch');

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('asks for her PIN first, reads nothing before it, and then shows her lines under the window', async () => {
  const fetched = serve();
  open();
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect((screen.getByLabelText(label('myWork.pinLabel')) as HTMLInputElement).type).toBe(
    'password',
  );
  expect(fetched.paths('/service-lines').length).toBe(0);
  await signIn();
  const opening = fetched.paths('/private-view').find((request) => request.method === 'POST');
  expect(await opening?.clone().json()).toEqual({ pin: PIN });
  expect(fetched.paths('/service-lines')[0]?.headers.get('x-private-view-window-id')).toBe(WINDOW);
  expect(fetched.paths('/tips')[0]?.headers.get('x-private-view-window-id')).toBe(WINDOW);
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
});

it('keeps the PIN step with a message and a cleared field after a wrong PIN', async () => {
  const fetched = serve({ open: () => json({ code: 'PIN_INVALID' }, 401) });
  open();
  await enterPin('0000');
  expect(await screen.findByText(label('myWork.pinInvalid'))).toBeTruthy();
  expect((screen.getByLabelText(label('myWork.pinLabel')) as HTMLInputElement).value).toBe('');
  expect(fetched.paths('/service-lines').length).toBe(0);
});

it('refuses a malformed PIN on the screen without calling the server', async () => {
  const fetched = serve();
  open();
  await enterPin('12');
  expect(await screen.findByText(label('myWork.pinInvalid'))).toBeTruthy();
  expect(fetched.paths('/private-view').length).toBe(0);
});

it('leaves the private screen when the session ended while the PIN was being checked', async () => {
  const onLeave = vi.fn();
  serve({ open: () => json({ code: 'UNAUTHENTICATED' }, 401) });
  open(onLeave);
  await enterPin();
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Haircut')).toBeNull();
});

it('returns to the PIN step after 60 seconds without input and leaves nothing of hers behind', async () => {
  const fetched = serve();
  const view = open();
  await signIn();
  await act(() => vi.advanceTimersByTimeAsync(59_000));
  expect(screen.getByText('Haircut')).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(1_500));
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect(screen.getByText(t('en', 'errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
  await waitFor(() => expect(fetched.paths('/private-view/close').length).toBe(1));
  expect(fetched.paths('/private-view/close')[0]?.headers.get('x-private-view-window-id')).toBe(
    WINDOW,
  );
});

it('closes the private screen on the first input after the deadline, with no touch and nothing logged', async () => {
  const logged: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    }),
  );
  try {
    const fetched = serve();
    const view = open();
    await signIn();
    // ساعة الجهاز اتغيّرت (الجهاز نام): الموعد فات والمؤقت لسه ما اشتغلش.
    vi.setSystemTime(new Date(Date.now() + 3_600_000));
    typeInMyWork('a');
    // القفل بيحصل مع أول تفاعل بعد الموعد، مش مستني فحص الثانية.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetched.paths('/private-view/close').length).toBe(1);
    expect(touches(fetched).length).toBe(0);
    expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
    expect(screen.queryByText('Haircut')).toBeNull();
    expect(myWorkEntries(view.client).length).toBe(0);
    expect(logged.join('\n')).not.toContain(WINDOW);
    expect(logged.join('\n')).not.toContain(PIN);
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
});

it('lets input push the 60 second limit back', async () => {
  serve();
  open();
  await signIn();
  await act(() => vi.advanceTimersByTimeAsync(50_000));
  typeInMyWork('a');
  await act(() => vi.advanceTimersByTimeAsync(50_000));
  expect(screen.getByText('Haircut')).toBeTruthy();
});

it('does not let activity on a sibling reception panel keep her lines on screen past 60 seconds', async () => {
  const fetched = serve();
  renderWork(
    <>
      <MyWorkScreen context={context} onLeave={() => undefined} />
      <button type="button">attendance panel</button>
    </>,
  );
  await signIn();
  const sibling = screen.getByText('attendance panel');
  await act(() => vi.advanceTimersByTimeAsync(50_000));
  fireEvent.keyDown(sibling, { key: 'a' });
  fireEvent.pointerDown(sibling);
  await act(() => vi.advanceTimersByTimeAsync(11_000));
  expect(await screen.findByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(touches(fetched).length).toBe(0);
});

it('sends the activity touch at most once every 20 seconds and only because of input', async () => {
  const fetched = serve();
  open();
  await signIn();
  await act(() => vi.advanceTimersByTimeAsync(40_000));
  expect(touches(fetched).length).toBe(0);
  typeInMyWork('a');
  typeInMyWork('b');
  pointInMyWork();
  await waitFor(() => expect(touches(fetched).length).toBe(1));
  expect(touches(fetched)[0]?.headers.get('x-private-view-window-id')).toBe(WINDOW);
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  typeInMyWork('c');
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(touches(fetched).length).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(touches(fetched).length).toBe(2);
});

it('restarts from the first page when the next page cursor expired', async () => {
  const fetched = serve({
    lines: (_request, url) =>
      url.searchParams.get('cursor') === 'next-1'
        ? json({ code: 'VALIDATION_FAILED' }, 400)
        : json(linesPage([fullLine], 'next-1')),
  });
  open();
  await signIn();
  fireEvent.click(screen.getByText(label('myWork.loadMore')));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByText(label('myWork.retry')));
  expect(await screen.findByText('Haircut')).toBeTruthy();
  const cursors = fetched
    .paths('/service-lines')
    .map((request) => new URL(request.url).searchParams.get('cursor'));
  expect(cursors).toEqual([null, 'next-1', null]);
});

it('goes back to the PIN step when a touch says the window expired', async () => {
  serve({ touch: () => json({ code: 'PRIVATE_VIEW_EXPIRED' }, 403) });
  const view = open();
  await signIn();
  await act(() => vi.advanceTimersByTimeAsync(21_000));
  typeInMyWork('a');
  expect(await screen.findByText(t('en', 'errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('returns to the PIN step when a read answers PRIVATE_VIEW_EXPIRED, with her still the operator', async () => {
  const onLeave = vi.fn();
  serve({ lines: () => json({ code: 'PRIVATE_VIEW_EXPIRED' }, 403) });
  const view = open(onLeave);
  await enterPin();
  expect(await screen.findByText(t('en', 'errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
  expect(screen.getByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  expect(onLeave).not.toHaveBeenCalled();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('leaves the private screen entirely when a read answers 401', async () => {
  const onLeave = vi.fn();
  const fetched = serve({ lines: () => json({ code: 'UNAUTHENTICATED' }, 401) });
  const view = open(onLeave);
  await enterPin();
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
  await waitFor(() => expect(fetched.paths('/private-view/close').length).toBe(1));
});

it('closes the window and shows the PIN step with the refused message when a read is forbidden', async () => {
  const fetched = serve({ lines: () => json({ code: 'FORBIDDEN' }, 403) });
  const onLeave = vi.fn();
  open(onLeave);
  await enterPin();
  expect(await screen.findByText(label('myWork.refused'))).toBeTruthy();
  expect(screen.getByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  expect(onLeave).not.toHaveBeenCalled();
  await waitFor(() => expect(fetched.paths('/private-view/close').length).toBe(1));
});

it('closes the window and clears the cache when the screen is left', async () => {
  const fetched = serve();
  const view = open();
  await signIn();
  view.unmount();
  expect(myWorkEntries(view.client).length).toBe(0);
  await waitFor(() => expect(fetched.paths('/private-view/close').length).toBe(1));
  expect(fetched.paths('/private-view/close')[0]?.headers.get('x-private-view-window-id')).toBe(
    WINDOW,
  );
});

it('never lets a late read repopulate the screen after the idle close', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  replaceFetch(async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/service-lines')) {
      await gate;
      return json(linesPage([fullLine]));
    }
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view')) return json(window_);
    return json(hiddenTips());
  });
  const view = open();
  await enterPin();
  expect(await screen.findByText(label('myWork.loading'))).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(61_000));
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
  release();
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('starts from the PIN step again when another operator replaces her', async () => {
  serve();
  function Harness() {
    const [identity, setIdentity] = useState(context.identity);
    return (
      <>
        <button onClick={() => setIdentity('1:mona:device:2026-12-01')}>replace</button>
        <MyWorkScreen key={identity} context={{ ...context, identity }} onLeave={() => undefined} />
      </>
    );
  }
  renderWork(<Harness />);
  await signIn();
  fireEvent.click(screen.getByText('replace'));
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
});

it('AC-57-4-9 shows the line time and the cancellation date in the business zone on the reception device too', async () => {
  const instant = '2026-11-14T21:30:00Z';
  const line = { ...fullLine, time: instant, cancelled: true, cancelled_at: instant };
  serve({ lines: () => json(linesPage([line], null, '2026-11', 'Asia/Kuwait')) });
  open();
  await enterPin();
  expect(await screen.findByText('00:30')).toBeTruthy();
  expect(screen.queryByText('21:30')).toBeNull();
  expect(screen.getByText(/Cancelled on\s+November 15, 2026/)).toBeTruthy();
});
