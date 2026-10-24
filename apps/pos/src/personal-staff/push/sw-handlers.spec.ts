import { describe, expect, it, vi } from 'vitest';

import type { PushRecord, PushRecordStore } from './push-record';
import { handleNotificationClick, handlePush } from './sw-handlers';

const TOKEN = 'delivery-token';
const BELL = String.fromCharCode(7);

const RECORD: PushRecord = {
  token: TOKEN,
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
  revision: 0,
};

function payload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    title: 'Clock-in',
    body: 'No clock-in yet for your 10:00 shift at Salmiya.',
    tag: 'shift-not-clocked-in',
    url: '/personal',
    lang: 'ar',
    t: TOKEN,
    ...over,
  });
}

function registration() {
  const showNotification = vi.fn(async () => undefined);
  return { showNotification };
}

function store(record: PushRecord | null): PushRecordStore {
  return {
    read: async () => record,
    write: async () => undefined,
    remove: async () => undefined,
    suspend: async () => undefined,
    generation: async () => 0,
    bumpGeneration: async () => 1,
    writeIfGeneration: async () => true,
  };
}

function failingStore(): PushRecordStore {
  return {
    ...store(null),
    read: async () => {
      throw new Error('PUSH_STORE_UNAVAILABLE');
    },
  };
}

describe('the push handler shows the notice of the payload', () => {
  it('shows the title, the body, the language and the direction', async () => {
    const target = registration();

    await handlePush({ data: payload(), registration: target, store: store(RECORD) });

    expect(target.showNotification).toHaveBeenCalledTimes(1);
    expect(target.showNotification).toHaveBeenCalledWith('Clock-in', {
      body: 'No clock-in yet for your 10:00 shift at Salmiya.',
      tag: 'shift-not-clocked-in',
      lang: 'ar',
      dir: 'rtl',
      data: { url: '/personal' },
    });
  });

  it('reads the notice from the left for a language that is not Arabic', async () => {
    const target = registration();

    await handlePush({
      data: payload({ lang: 'en' }),
      registration: target,
      store: store(RECORD),
    });

    expect(target.showNotification).toHaveBeenCalledWith(
      'Clock-in',
      expect.objectContaining({ dir: 'ltr' }),
    );
  });
});

describe('the push handler shows the neutral notice', () => {
  it.each([
    ['a token that does not match', payload({ t: 'another-token' })],
    ['a payload that is not json', 'not-json'],
    ['a payload of another version', payload({ v: 2 })],
  ])('for %s', async (_case, data) => {
    const target = registration();

    await handlePush({ data, registration: target, store: store(RECORD) });

    expect(target.showNotification).toHaveBeenCalledWith('PosPay', {
      data: { url: '/personal' },
    });
  });

  it('when there is no record on the phone', async () => {
    const target = registration();

    await handlePush({ data: payload(), registration: target, store: store(null) });

    expect(target.showNotification).toHaveBeenCalledWith('PosPay', {
      data: { url: '/personal' },
    });
  });

  it('while the record is suspended', async () => {
    const target = registration();

    await handlePush({
      data: payload(),
      registration: target,
      store: store({ ...RECORD, suspended: true }),
    });

    expect(target.showNotification).toHaveBeenCalledWith('PosPay', {
      data: { url: '/personal' },
    });
  });

  it('when the local store cannot be read', async () => {
    const target = registration();

    await handlePush({ data: payload(), registration: target, store: failingStore() });

    expect(target.showNotification).toHaveBeenCalledWith('PosPay', {
      data: { url: '/personal' },
    });
  });
});

describe('the push handler keeps the link inside the app', () => {
  const links: [string, string][] = [
    ['a link to another site', 'https://example.com/steal'],
    ['a protocol relative link', '//example.com/steal'],
    ['a path that is not internal', 'personal'],
    ['a path with a backslash', '/\\evil.example'],
    ['a path with a control character', `/notice${BELL}`],
    ['a path that goes up and out', '/a/..//evil.example/path'],
    ['a path that flattens to another site', '/.//evil.example'],
    ['a path with an encoded dot', '/%2e//evil.example'],
  ];

  it.each(links)('falls back to the staff page for %s', async (_case, url) => {
    const target = registration();

    await handlePush({ data: payload({ url }), registration: target, store: store(RECORD) });

    expect(target.showNotification).toHaveBeenCalledWith(
      'Clock-in',
      expect.objectContaining({ data: { url: '/personal' } }),
    );
  });
});

describe('the notification click handler of the service worker', () => {
  function client(url: string) {
    const focus = vi.fn(async () => client(url));
    return { url, focus };
  }

  it('closes the notice and focuses the open window of the same origin', async () => {
    const close = vi.fn();
    const open = client('https://pos.example/personal');
    const other = client('https://elsewhere.example/personal');
    const openWindow = vi.fn(async () => null);

    await handleNotificationClick({
      notification: { close, data: { url: '/personal' } },
      clients: { matchAll: async () => [other, open], openWindow },
      origin: 'https://pos.example',
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(open.focus).toHaveBeenCalledTimes(1);
    expect(other.focus).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens the page when no window of the same origin is open', async () => {
    const close = vi.fn();
    const openWindow = vi.fn(async () => null);

    await handleNotificationClick({
      notification: { close, data: { url: '/personal' } },
      clients: { matchAll: async () => [client('https://elsewhere.example/personal')], openWindow },
      origin: 'https://pos.example',
    });

    expect(openWindow).toHaveBeenCalledWith('https://pos.example/personal');
  });

  it('opens the staff page when the notice carries no link', async () => {
    const openWindow = vi.fn(async () => null);

    await handleNotificationClick({
      notification: { close: vi.fn(), data: null },
      clients: { matchAll: async () => [], openWindow },
      origin: 'https://pos.example',
    });

    expect(openWindow).toHaveBeenCalledWith('https://pos.example/personal');
  });

  it('opens the staff page and not another site', async () => {
    const openWindow = vi.fn(async () => null);

    await handleNotificationClick({
      notification: { close: vi.fn(), data: { url: 'https://evil.example/steal' } },
      clients: { matchAll: async () => [], openWindow },
      origin: 'https://pos.example',
    });

    expect(openWindow).toHaveBeenCalledWith('https://pos.example/personal');
  });

  it('opens the staff page and not another site for a flattened path', async () => {
    const openWindow = vi.fn(async () => null);

    await handleNotificationClick({
      notification: { close: vi.fn(), data: { url: '/a/..//evil.example/path' } },
      clients: { matchAll: async () => [], openWindow },
      origin: 'https://pos.example',
    });

    expect(openWindow).toHaveBeenCalledWith('https://pos.example/personal');
  });
});
