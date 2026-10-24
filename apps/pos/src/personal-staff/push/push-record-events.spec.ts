import { expect, it } from 'vitest';

import { notifyPushRecordChanged, onPushRecordChanged } from './push-record-events';

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
