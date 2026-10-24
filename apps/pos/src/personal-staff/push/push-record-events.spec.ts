import { afterEach, expect, it, vi } from 'vitest';

import { notifyPushRecordChanged, onPushRecordChanged } from './push-record-events';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('tells every listener that the record changed', () => {
  const seen: string[] = [];
  const stopFirst = onPushRecordChanged(() => seen.push('first'));
  const stopSecond = onPushRecordChanged(() => seen.push('second'));

  notifyPushRecordChanged();

  expect(seen).toEqual(['first', 'second']);
  stopFirst();
  stopSecond();
});

it('stops telling a listener that unsubscribed', () => {
  const seen: string[] = [];
  const stop = onPushRecordChanged(() => seen.push('heard'));

  stop();
  notifyPushRecordChanged();

  expect(seen).toEqual([]);
});

it('keeps going when one listener throws', () => {
  const seen: string[] = [];
  const stop = onPushRecordChanged(() => {
    throw new Error('SYNTHETIC_LISTENER_FAILURE');
  });
  const stopOther = onPushRecordChanged(() => seen.push('heard'));

  notifyPushRecordChanged();

  expect(seen).toEqual(['heard']);
  stop();
  stopOther();
});

it('posts the change on the shared channel', () => {
  const posted: { name: string; data: unknown }[] = [];
  class FakeChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly name: string) {}
    postMessage(data: unknown) {
      posted.push({ name: this.name, data });
    }
    close() {}
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel);

  notifyPushRecordChanged();

  expect(posted).toEqual([{ name: 'pospay-push-record', data: 'CHANGED' }]);
});

it('reloads when another tab posts on the channel', () => {
  class FakeChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    static channels: FakeChannel[] = [];
    constructor(readonly name: string) {
      FakeChannel.channels.push(this);
    }
    postMessage(data: unknown) {
      for (const other of FakeChannel.channels) {
        if (other !== this) other.onmessage?.({ data } as MessageEvent);
      }
    }
    close() {}
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  const seen: string[] = [];
  const stop = onPushRecordChanged(() => seen.push('heard'));

  notifyPushRecordChanged();

  expect(seen.length).toBeGreaterThan(0);
  stop();
});
