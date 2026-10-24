import { describe, expect, it } from 'vitest';

import type { PushRecord } from './push-record';
import { decidePushState, type PushStateInput } from './push-state';

const COMPANY = '00000000-0000-4000-8000-000000000001';

function record(over: Partial<PushRecord> = {}): PushRecord {
  return {
    token: 'delivery-token',
    subscriber_ref: 'subscriber-ref',
    company_id: COMPANY,
    vapid_key_id: '0123456789abcdef',
    suspended: false,
    ...over,
  };
}

function input(over: Partial<PushStateInput> = {}): PushStateInput {
  return {
    notReady: false,
    storageBlocked: false,
    supported: true,
    installFirst: false,
    permission: 'default',
    online: true,
    record: null,
    companyId: COMPANY,
    browserSubscribed: false,
    reconnecting: false,
    ...over,
  };
}

describe('the five states of the mobile notifications control', () => {
  it('says the phone cannot receive notifications when the browser has no push', () => {
    const decision = decidePushState(input({ supported: false }));

    expect(decision.state).toBe('unsupported');
    expect(decision.visible).toBe(true);
  });

  it('shows the home screen instruction on an iPhone that is not installed', () => {
    const decision = decidePushState(input({ supported: false, installFirst: true }));

    expect(decision.state).toBe('install-first');
    expect(decision.visible).toBe(true);
  });

  it('says notifications are blocked when the browser denied them', () => {
    const decision = decidePushState(input({ permission: 'denied' }));

    expect(decision.state).toBe('blocked');
    expect(decision.visible).toBe(true);
  });

  it('shows off with nothing stored on the phone', () => {
    expect(decidePushState(input()).state).toBe('off');
  });

  it('shows on only with a record of this company, permission and a browser subscription', () => {
    const decision = decidePushState(
      input({
        permission: 'granted',
        record: record(),
        browserSubscribed: true,
      }),
    );

    expect(decision.state).toBe('on');
  });

  const offCases: [string, Partial<PushStateInput>][] = [
    ['another company', { record: record({ company_id: 'other' }) }],
    ['a suspended record', { record: record({ suspended: true }) }],
    ['no browser subscription', { browserSubscribed: false }],
    ['no permission', { permission: 'default' }],
  ];

  it.each(offCases)('shows off with %s', (_case, over) => {
    const decision = decidePushState(
      input({ permission: 'granted', record: record(), browserSubscribed: true, ...over }),
    );

    expect(decision.state).toBe('off');
  });
});

describe('the modifiers of the control', () => {
  it('hides the control when the API has no push configuration', () => {
    const decision = decidePushState(input({ notReady: true }));

    expect(decision.visible).toBe(false);
  });

  it('shows the unsupported state with its own text when the storage is blocked', () => {
    const decision = decidePushState(input({ storageBlocked: true, supported: false }));

    expect(decision.state).toBe('unsupported');
    expect(decision.storageBlocked).toBe(true);
  });

  it('marks the control offline when there is no connection', () => {
    expect(decidePushState(input({ online: false })).offline).toBe(true);
  });

  it('shows off with a reconnecting note while the comparison failed', () => {
    const decision = decidePushState(input({ record: record({ suspended: true }), reconnecting: true }));

    expect(decision.state).toBe('off');
    expect(decision.reconnecting).toBe(true);
  });

  it('shows off without a reconnecting note for a suspended record of another company', () => {
    const decision = decidePushState(
      input({ record: record({ suspended: true, company_id: 'other' }), reconnecting: true }),
    );

    expect(decision.state).toBe('off');
    expect(decision.reconnecting).toBe(false);
  });

  it('drops the reconnecting note once the notifications are on', () => {
    const decision = decidePushState(
      input({ permission: 'granted', record: record(), browserSubscribed: true, reconnecting: true }),
    );

    expect(decision.state).toBe('on');
    expect(decision.reconnecting).toBe(false);
  });
});
