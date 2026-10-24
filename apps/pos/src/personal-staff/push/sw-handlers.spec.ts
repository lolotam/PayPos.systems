import { describe, expect, it, vi } from 'vitest';

import type { PushRecord } from './push-record';
import { handleNotificationClick, handlePush } from './sw-handlers';

const TOKEN = 'delivery-token';

const RECORD: PushRecord = {
  token: TOKEN,
  subscriber_ref: 'subscriber-ref',
  company_id: 'company',
  vapid_key_id: '0123456789abcdef',
  suspended: false,
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

function store(record: PushRecord | null) {
  return {
    read: async () => record,
    write: async () => undefined,
    remove: async () => undefined,
  };
}

describe('the push handler of the service worker', () => {
  it('shows the notice with its title, body, language and direction', async () => {
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

  it.each([
    ['a token that does not match', payload({ t: 'another-token' })],
    ['a payload that is not json', 'not-json'],
    ['a payload of another version', payload({ v: 2 })],
  ])('shows the neutral notice for %s', async (_case, data) => {
    const target = registration();

    await handlePush({ data, registration: target, store: store(RECORD) });

    expect(target.showNotification).toHaveBeenCalledWith('PosPay', {
      data: { url: '/personal' },
    });
  });

  it('shows the neutral notice when there is no record on the phone', async () => {
    const target = registration();

    await handlePush({ data: payload(), registration: target, store: store(null) });

    expect(target.showNotification).toHaveBeenCalledWith('PosPay', {
      data: { url: '/personal' },
    });
  });

  it('shows the neutral notice while the record is suspended', async () => {
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

  it('shows the neutral notice when the local store cannot be read', async () => {
    const target = registration();
    const failing = {
      read: async () => {
        throw new Error('PUSH_STORE_UNAVAILABLE');
      },
      write: async () => undefined,
      remove: async () => undefined,
    };

    await handlePush({ data: payload(), registration: target, store: failing });

    expect(target.showNotification).toHaveBeenCalledWith('PosPay', {
      data: { url: '/personal' },
    });
  });

  it.each([
    ['a link to another site', 'https://example.com/steal'],
    ['a protocol relative link', '//example.com/steal'],
    ['a path that is not internal', 'personal'],
  ])('falls back to the staff page for %s', async (_case, url) => {
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
    const navigate = vi.fn(async () => client(url));
    return { url, focus, navigate };
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
    expect(open.navigate).toHaveBeenCalledWith('/personal');
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

    expect(openWindow).toHaveBeenCalledWith('/personal');
  });

  it('opens the staff page when the notice carries no link', async () => {
    const openWindow = vi.fn(async () => null);

    await handleNotificationClick({
      notification: { close: vi.fn(), data: null },
      clients: { matchAll: async () => [], openWindow },
      origin: 'https://pos.example',
    });

    expect(openWindow).toHaveBeenCalledWith('/personal');
  });
});
