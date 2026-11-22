import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import { fullLine, hiddenTips, linesPage } from './work-fixtures';
import { installFetch, json, myWorkEntries, renderWork, replaceFetch } from './work-test-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const WINDOW = 'window-abc';
const KEY = 'pospay-private-view-window';
const context: WorkContext = { mode: 'reception', identity: '0:sara:device:2026-12-01' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const opened = {
  window_id: WINDOW,
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: 60_000,
  cap_remaining_ms: 300_000,
};
const keyOf = (windowId: string, windowSeq: string, sessionRef = 'ref') =>
  JSON.stringify({
    windowId,
    sessionRef,
    windowSeq,
    idleWallAt: Date.now() + 60_000,
    capWallAt: Date.now() + 300_000,
  });
const open = () => renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />);
const enterPin = async () => {
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
};

class SpyChannel {
  static all: SpyChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() {
    SpyChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const other of SpyChannel.all)
      if (other !== this) other.onmessage?.({ data } as MessageEvent);
  }
  close() {
    SpyChannel.all = SpyChannel.all.filter((channel) => channel !== this);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  SpyChannel.all = [];
  vi.stubGlobal('BroadcastChannel', SpyChannel);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('discards a read whose response arrives before the storage notification of a newer window', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  replaceFetch(async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view')) return json(opened);
    await gate;
    return url.pathname.endsWith('/tips') ? json(hiddenTips()) : json(linesPage([fullLine]));
  });
  const view = open();
  const published: unknown[] = [];
  view.client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success')
      published.push(event.query.queryKey);
  });
  await enterPin();
  expect(await screen.findByText(label('myWork.loading'))).toBeTruthy();
  localStorage.setItem(KEY, keyOf('window-new', '2'));
  release();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(published).toEqual([]);
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ windowId: 'window-new' });
});

it('stops rendering rows of a window that a newer window replaced, before any storage event', async () => {
  installFetch((_request, url) => {
    if (url.pathname.endsWith('/private-view')) return json(opened);
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    if (url.pathname.endsWith('/service-lines')) return json(linesPage([fullLine]));
    return undefined;
  });
  const view = open();
  await enterPin();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  localStorage.setItem(KEY, keyOf('window-new', '2'));
  view.rerenderWork(<MyWorkScreen context={context} onLeave={() => undefined} />);
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('fails closed when the shared key cannot be written, and retires the older tab by channel', async () => {
  const fetched = installFetch((_request, url) => {
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view')) return json(opened);
    return undefined;
  });
  localStorage.setItem(KEY, keyOf('window-old', '1', 'older-ref'));
  const older = new SpyChannel();
  const heard: unknown[] = [];
  older.onmessage = (event) => heard.push(event.data);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const view = open();
  await enterPin();
  expect(await screen.findByText(label('myWork.pinUnavailable'))).toBeTruthy();
  expect(screen.getByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  expect(fetched.paths('/service-lines').length).toBe(0);
  expect(myWorkEntries(view.client).length).toBe(0);
  await vi.waitFor(() => expect(fetched.paths('/private-view/close').length).toBe(1));
  expect(heard).toEqual([{ windowId: 'window-old' }]);
});

it('retires the tab and publishes nothing when the shared key turns unreadable before a delayed read', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  replaceFetch(async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view')) return json(opened);
    await gate;
    return url.pathname.endsWith('/tips') ? json(hiddenTips()) : json(linesPage([fullLine]));
  });
  const view = open();
  const published: unknown[] = [];
  view.client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success')
      published.push(event.query.queryKey);
  });
  await enterPin();
  expect(await screen.findByText(label('myWork.loading'))).toBeTruthy();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  release();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(published).toEqual([]);
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
});

it('returns an older tab to the PIN step when a newer opening cannot write the key and no channel exists', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  let openings = 0;
  installFetch((_request, url) => {
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view'))
      return json(
        ++openings === 1 ? opened : { ...opened, window_id: 'window-two', window_seq: '2' },
      );
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    if (url.pathname.endsWith('/service-lines')) return json(linesPage([fullLine]));
    return undefined;
  });
  const older = open();
  await enterPin();
  expect(await within(older.container).findByText('Haircut')).toBeTruthy();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const newer = open();
  await enterPin();
  expect(await within(newer.container).findByText(label('myWork.pinUnavailable'))).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(await within(older.container).findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect(within(older.container).queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(older.client).length).toBe(0);
  expect(localStorage.getItem(KEY)).toBeNull();
});
