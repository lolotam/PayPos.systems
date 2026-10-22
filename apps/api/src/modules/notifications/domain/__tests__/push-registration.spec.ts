import { describe, expect, it } from 'vitest';

import {
  planPushRegistration,
  type LivePushRow,
  type PushRegistrationPlan,
} from '../push-registration.ts';

const INSTALL = 'install-a';
const ENDPOINT = 'endpoint-a';

const row = (id: string, over: Partial<LivePushRow> = {}): LivePushRow => ({
  id,
  userId: 'user-1',
  installationHash: INSTALL,
  endpointHash: ENDPOINT,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...over,
});

const plan = (over: Partial<PushRegistrationPlan> = {}): PushRegistrationPlan => ({
  callerUserId: 'user-1',
  installationHash: INSTALL,
  endpointHash: ENDPOINT,
  cap: 5,
  callerRows: [],
  endpointHolders: [],
  ...over,
});

describe('planPushRegistration', () => {
  it('revokes nothing when there is no other row', () => {
    expect(planPushRegistration(plan()).revoke).toEqual([]);
  });

  it('revokes the oldest caller row when the cap is exceeded', () => {
    const callerRows = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      row(id, { installationHash: `install-${id}` }),
    );
    const decision = planPushRegistration(plan({ callerRows }));
    expect(decision.revoke).toEqual([{ id: 'a', reason: 'CAP_EXCEEDED' }]);
  });

  it('revokes nothing when the caller is one below the cap', () => {
    const callerRows = ['a', 'b', 'c', 'd'].map((id) =>
      row(id, { installationHash: `install-${id}` }),
    );
    expect(planPushRegistration(plan({ callerRows })).revoke).toEqual([]);
  });

  it('never revokes the caller row for the same install, so a refresh keeps its row', () => {
    const callerRows = [
      row('own', { installationHash: INSTALL }),
      ...['a', 'b', 'c', 'd', 'e'].map((id) => row(id, { installationHash: `install-${id}` })),
    ];
    const decision = planPushRegistration(plan({ callerRows }));
    expect(decision.revoke).toEqual([{ id: 'a', reason: 'CAP_EXCEEDED' }]);
    expect(decision.revoke.map((entry) => entry.id)).not.toContain('own');
  });

  it('moves an endpoint held by another user and revokes the old owner', () => {
    const holder = row('held', { userId: 'user-2' });
    const decision = planPushRegistration(plan({ endpointHolders: [holder] }));
    expect(decision.revoke).toEqual([{ id: 'held', reason: 'OWNER_CHANGED' }]);
  });

  it('revokes the caller own other install for the same endpoint', () => {
    const holder = row('held', { installationHash: 'install-other' });
    const decision = planPushRegistration(plan({ endpointHolders: [holder] }));
    expect(decision.revoke).toEqual([{ id: 'held', reason: 'REPLACED' }]);
  });

  it('keeps the caller row for the same install and the same endpoint', () => {
    const own = row('own');
    const decision = planPushRegistration(
      plan({ endpointHolders: [own], callerRows: [own] }),
    );
    expect(decision.revoke).toEqual([]);
  });

  it('counts a holder that is also a caller row once', () => {
    const holder = row('held', { installationHash: 'install-other' });
    const decision = planPushRegistration(
      plan({ endpointHolders: [holder], callerRows: [holder] }),
    );
    expect(decision.revoke).toEqual([{ id: 'held', reason: 'REPLACED' }]);
  });

  it('ignores a holder of another endpoint', () => {
    const holder = row('held', { endpointHash: 'endpoint-other' });
    expect(planPushRegistration(plan({ endpointHolders: [holder] })).revoke).toEqual([]);
  });

  it('revokes the oldest first and breaks a tie by id', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const callerRows = [
      row('b', { installationHash: 'i-b', createdAt: at }),
      row('a', { installationHash: 'i-a', createdAt: at }),
      row('c', { installationHash: 'i-c', createdAt: new Date('2026-09-01T00:00:00.000Z') }),
    ];
    const decision = planPushRegistration(plan({ callerRows, cap: 2 }));
    expect(decision.revoke).toEqual([
      { id: 'c', reason: 'CAP_EXCEEDED' },
      { id: 'a', reason: 'CAP_EXCEEDED' },
    ]);
  });

  it('does not count a row that step one already revoked', () => {
    const holder = row('held', { installationHash: 'install-other' });
    const callerRows = [
      holder,
      ...['a', 'b', 'c', 'd'].map((id) => row(id, { installationHash: `install-${id}` })),
    ];
    const decision = planPushRegistration(plan({ endpointHolders: [holder], callerRows }));
    expect(decision.revoke).toEqual([{ id: 'held', reason: 'REPLACED' }]);
  });
});
