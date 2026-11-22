import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { fullLine, hiddenTips, linesPage } from '@/my-work/ui/work-fixtures';
import {
  installFetch,
  json,
  myWorkEntries,
  renderWork,
  replaceFetch,
} from '@/my-work/ui/work-test-kit';
import { ReceptionOwnEntries } from './reception-own-entries';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const session = {
  user_id: id(1),
  company_id: id(2),
  business_id: id(3),
  branch_id: id(5),
  device_id: id(6),
  expires_at: '2026-12-01T10:00:00.000Z',
};
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const KEY = 'pospay-private-view-window';
const CHANNEL = 'pospay-private-view-close';
const remaining = (idle: number, cap: number) => ({
  idle_remaining_ms: idle,
  cap_remaining_ms: cap,
});
const openedWindow = (n: number, cap = 300_000) => ({
  window_id: `window-${n}`,
  window_seq: String(n),
  session_ref: 'ref',
  ...remaining(60_000, cap),
});

/** قناة مزيفة تربط تابات الجهاز: كل رسالة بتوصل لباقي النسخ بنفس الاسم. */
class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all)
      if (other !== this && !other.closed && other.name === this.name)
        other.onmessage?.({ data } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

type Reply = Response | Promise<Response>;
type Script = { open?: (call: number) => Reply; touch?: () => Reply; cap?: number };

/** سيرفر نافذة العرض الخاص؛ كل فتح بياخد رقم أكبر (نافذة جديدة تبدّل القديمة). */
function serve(initial: Script = {}) {
  const script = initial;
  installFetch(() => undefined);
  const requests: Request[] = [];
  let opened = 0;
  replaceFetch(async (request) => {
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/private-view/touch'))
      return script.touch?.() ?? json(remaining(60_000, 300_000));
    if (path.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (path.endsWith('/private-view')) {
      opened += 1;
      return script.open?.(opened) ?? json(openedWindow(opened, script.cap));
    }
    if (path.endsWith('/service-lines')) return json(linesPage([fullLine]));
    if (path.endsWith('/tips')) return json(hiddenTips());
    return json({ code: 'NOT_FOUND' }, 404);
  });
  return {
    script,
    paths: (suffix: string) =>
      requests.filter((request) => new URL(request.url).pathname.endsWith(suffix)),
  };
}

const mountTab = () =>
  renderWork(
    <ReceptionOwnEntries
      session={session}
      epoch={0}
      branchId={id(5)}
      deviceId={id(6)}
      zone={null}
    />,
  );
type Tab = ReturnType<typeof mountTab>;

const openScreen = (tab: Tab) => {
  const ui = within(tab.container);
  fireEvent.click(ui.getByRole('button', { name: label('myWork.title') }));
  return ui;
};
const typePin = async (tab: Tab) => {
  const input = await waitFor(() => {
    const field = tab.container.querySelector('input[type="password"]');
    if (field === null) throw new Error('no PIN field yet');
    return field;
  });
  fireEvent.change(input, { target: { value: '4321' } });
  fireEvent.click(within(tab.container).getByText(label('myWork.pinSubmit')));
};
const signIn = async (tab: Tab) => {
  const ui = openScreen(tab);
  await typePin(tab);
  expect(await ui.findByText('Haircut')).toBeTruthy();
};
const showsRows = (tab: Tab) => within(tab.container).queryByText('Haircut') !== null;
const onPinStep = async (tab: Tab) => {
  expect(await within(tab.container).findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect(showsRows(tab)).toBe(false);
  expect(myWorkEntries(tab.client).length).toBe(0);
};

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const setVisibility = (state: 'visible' | 'hidden') =>
  act(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  });
const pageshow = (persisted: boolean) =>
  act(() => {
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
  });
const storageEvent = (init: StorageEventInit) =>
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, ...init }));
  });
const otherTab = () => new FakeChannel(CHANNEL);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('closes at once, with no request, when another tab says the window it shows has closed', async () => {
  const fetched = serve();
  const tab = mountTab();
  await signIn(tab);
  act(() => otherTab().postMessage({ windowId: 'window-1' }));
  await onPinStep(tab);
  expect(within(tab.container).getByText(label('errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
  expect(fetched.paths('/private-view/close').length).toBe(0);
});

it('tells the other tabs which window closed and removes the key when its own cap is reached', async () => {
  const fetched = serve({ cap: 20_000 });
  const tab = mountTab();
  const heard: unknown[] = [];
  const listener = otherTab();
  listener.onmessage = (event) => heard.push(event.data);
  await signIn(tab);
  expect(localStorage.getItem(KEY)).not.toBeNull();
  await advance(21_000);
  await onPinStep(tab);
  expect(heard).toEqual([{ windowId: 'window-1' }]);
  expect(localStorage.getItem(KEY)).toBeNull();
  await waitFor(() => expect(fetched.paths('/private-view/close').length).toBe(1));
});

it('ignores a close signal for a different window and keeps the newer window open', async () => {
  const fetched = serve();
  const tab = mountTab();
  await signIn(tab);
  const stored = localStorage.getItem(KEY);
  const olderKey = JSON.stringify({ ...JSON.parse(stored ?? '{}'), windowId: 'window-0' });
  act(() => otherTab().postMessage({ windowId: 'window-0' }));
  storageEvent({ oldValue: olderKey, newValue: null });
  storageEvent({ key: 'unrelated', oldValue: 'x', newValue: null });
  await advance(1_000);
  expect(showsRows(tab)).toBe(true);
  expect(localStorage.getItem(KEY)).toBe(stored);
  expect(fetched.paths('/private-view/close').length).toBe(0);
});

it('retires an older tab at once when a newer window of the same device takes the key', async () => {
  const fetched = serve();
  const older = mountTab();
  await signIn(older);
  const olderKey = localStorage.getItem(KEY);
  const newer = mountTab();
  await signIn(newer);
  const newerKey = localStorage.getItem(KEY);
  expect(JSON.parse(newerKey ?? '{}')).toMatchObject({ windowId: 'window-2', windowSeq: '2' });
  storageEvent({ oldValue: olderKey, newValue: newerKey });
  await onPinStep(older);
  expect(showsRows(newer)).toBe(true);
  expect(localStorage.getItem(KEY)).toBe(newerKey);
  expect(fetched.paths('/private-view/close').length).toBe(0);
});

it('never lets an older opening that answers late replace the newer window', async () => {
  let answerOlder: () => void = () => undefined;
  serve({
    open: (call) =>
      call === 1
        ? new Promise<Response>((resolve) => {
            answerOlder = () => resolve(json(openedWindow(1)));
          })
        : json(openedWindow(2)),
  });
  const older = mountTab();
  openScreen(older);
  await typePin(older);
  const newer = mountTab();
  await signIn(newer);
  const newerKey = localStorage.getItem(KEY);
  answerOlder();
  await onPinStep(older);
  expect(within(older.container).getByText(label('errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
  expect(localStorage.getItem(KEY)).toBe(newerKey);
  expect(showsRows(newer)).toBe(true);
});

it('shows no rows when it returns to the foreground until one touch passes, then shows them again', async () => {
  let answer: () => void = () => undefined;
  const server = serve();
  const tab = mountTab();
  await signIn(tab);
  server.script.touch = () =>
    new Promise<Response>((resolve) => {
      answer = () => resolve(json(remaining(60_000, 280_000)));
    });
  await setVisibility('hidden');
  await advance(5_000);
  await setVisibility('visible');
  expect(showsRows(tab)).toBe(false);
  expect(myWorkEntries(tab.client).length).toBe(0);
  expect(within(tab.container).queryByText(label('myWork.pinTitle'))).toBeNull();
  await act(async () => answer());
  expect(await within(tab.container).findByText('Haircut')).toBeTruthy();
  expect(server.paths('/service-lines').length).toBe(2);
});

it('goes to the PIN step with no rows when the touch on return is refused', async () => {
  const server = serve();
  const tab = mountTab();
  await signIn(tab);
  server.script.touch = () => json({ code: 'PRIVATE_VIEW_EXPIRED' }, 403);
  await setVisibility('hidden');
  await setVisibility('visible');
  await onPinStep(tab);
});

it('returns from the back-forward cache only after a touch, and not at all when it was a normal page show', async () => {
  let touches = 0;
  const server = serve();
  const tab = mountTab();
  await signIn(tab);
  server.script.touch = () => {
    touches += 1;
    return json({ code: 'PRIVATE_VIEW_EXPIRED' }, 403);
  };
  await pageshow(false);
  expect(showsRows(tab)).toBe(true);
  expect(touches).toBe(0);
  await pageshow(true);
  await onPinStep(tab);
  expect(touches).toBe(1);
});

it('shows the PIN step with no rows and sends no touch when the device wakes after the shared deadline', async () => {
  const fetched = serve();
  const tab = mountTab();
  await signIn(tab);
  await setVisibility('hidden');
  vi.setSystemTime(Date.now() + 120_000);
  await setVisibility('visible');
  await onPinStep(tab);
  expect(fetched.paths('/private-view/touch').length).toBe(0);
  expect(localStorage.getItem(KEY)).toBeNull();
});

it('closes a restored page whose deadline has already passed without a touch', async () => {
  const fetched = serve();
  const tab = mountTab();
  await signIn(tab);
  vi.setSystemTime(Date.now() + 120_000);
  await pageshow(true);
  await onPinStep(tab);
  expect(fetched.paths('/private-view/touch').length).toBe(0);
});

it('writes nothing private to any storage: only the window metadata key, and it is removed on close', async () => {
  serve({ cap: 20_000 });
  const tab = mountTab();
  await signIn(tab);
  expect(Object.keys(localStorage)).toEqual([KEY]);
  const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
  expect(Object.keys(stored).sort()).toEqual(
    ['capWallAt', 'idleWallAt', 'sessionRef', 'windowId', 'windowSeq'].sort(),
  );
  const everything = JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
  for (const secret of ['4321', 'Haircut', 'Customer One', '9.000', 'paired-device'])
    expect(everything).not.toContain(secret);
  expect(sessionStorage.length).toBe(0);
  await advance(21_000);
  await onPinStep(tab);
  expect(localStorage.length).toBe(0);
});
