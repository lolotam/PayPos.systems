import { describe, expect, it } from 'vitest';

import {
  planPackageTypeSelling,
  type PackageTypeSellingDecision,
  type PackageTypeSellingState,
} from '../package-type-selling.ts';

const at = new Date('2026-10-08T10:00:00.000Z');
const later = new Date('2026-10-09T11:30:00.000Z');

const active: PackageTypeSellingState = { selling_stopped_at: null, revision: 4 };
const stopped: PackageTypeSellingState = {
  selling_stopped_at: '2026-10-01T08:30:00.000Z',
  revision: 7,
};

function afterState(decision: PackageTypeSellingDecision): PackageTypeSellingState {
  if (decision.kind === 'revision-conflict') throw new Error('decision carries no next state');
  return decision.after;
}

describe('stopping and resuming the selling of a package type', () => {
  it('stops an active type and stamps the injected time', () => {
    expect(planPackageTypeSelling(active, 4, 'STOPPED', at)).toEqual({
      kind: 'change',
      before: { selling_stopped_at: null, revision: 4 },
      after: { selling_stopped_at: '2026-10-08T10:00:00.000Z', revision: 5 },
    });
  });

  it('resumes a stopped type and clears the stop time', () => {
    expect(planPackageTypeSelling(stopped, 7, 'ACTIVE', at)).toEqual({
      kind: 'change',
      before: { selling_stopped_at: '2026-10-01T08:30:00.000Z', revision: 7 },
      after: { selling_stopped_at: null, revision: 8 },
    });
  });

  it('advances the revision exactly once on an accepted change', () => {
    expect(afterState(planPackageTypeSelling(active, 4, 'STOPPED', at)).revision).toBe(5);
    expect(afterState(planPackageTypeSelling(stopped, 7, 'ACTIVE', at)).revision).toBe(8);
  });

  it('stamps the injected time and never reads the clock', () => {
    const stoppedNow = afterState(planPackageTypeSelling(active, 4, 'STOPPED', at));
    const stoppedLater = afterState(planPackageTypeSelling(active, 4, 'STOPPED', later));
    expect(stoppedNow.selling_stopped_at).toBe(at.toISOString());
    expect(stoppedLater.selling_stopped_at).toBe(later.toISOString());
  });

  it('clears the stop time on resume whatever the injected time is', () => {
    const resumed = afterState(planPackageTypeSelling(stopped, 7, 'ACTIVE', later));
    expect(resumed.selling_stopped_at).toBeNull();
  });
});

describe('the version check of the selling transition', () => {
  it.each([3, 5, 0])('refuses a stale version %i before the state check', (expected) => {
    expect(planPackageTypeSelling(active, expected, 'ACTIVE', at)).toEqual({
      kind: 'revision-conflict',
      before: { selling_stopped_at: null, revision: 4 },
    });
  });

  it('refuses a stale version on a type that is already stopped', () => {
    expect(planPackageTypeSelling(stopped, 6, 'STOPPED', at)).toEqual({
      kind: 'revision-conflict',
      before: { selling_stopped_at: '2026-10-01T08:30:00.000Z', revision: 7 },
    });
  });

  it('carries no next state on a refused version', () => {
    const decision = planPackageTypeSelling(active, 3, 'STOPPED', at);
    expect(decision).not.toHaveProperty('after');
  });
});

describe('a request that changes nothing', () => {
  it('reports no change when the type is already active', () => {
    expect(planPackageTypeSelling(active, 4, 'ACTIVE', at)).toEqual({
      kind: 'unchanged',
      before: { selling_stopped_at: null, revision: 4 },
      after: { selling_stopped_at: null, revision: 4 },
    });
  });

  it('reports no change when the type is already stopped', () => {
    expect(planPackageTypeSelling(stopped, 7, 'STOPPED', at)).toEqual({
      kind: 'unchanged',
      before: { selling_stopped_at: '2026-10-01T08:30:00.000Z', revision: 7 },
      after: { selling_stopped_at: '2026-10-01T08:30:00.000Z', revision: 7 },
    });
  });

  it('keeps a repeated stop request a no-op without advancing the revision', () => {
    const first = planPackageTypeSelling(active, 4, 'STOPPED', at);
    expect(first.kind).toBe('change');
    const stoppedNow: PackageTypeSellingState = {
      selling_stopped_at: '2026-10-08T10:00:00.000Z',
      revision: 5,
    };
    expect(planPackageTypeSelling(stoppedNow, 5, 'STOPPED', at)).toEqual({
      kind: 'unchanged',
      before: { selling_stopped_at: '2026-10-08T10:00:00.000Z', revision: 5 },
      after: { selling_stopped_at: '2026-10-08T10:00:00.000Z', revision: 5 },
    });
  });

  it('keeps a repeated resume request a no-op without advancing the revision', () => {
    const first = planPackageTypeSelling(stopped, 7, 'ACTIVE', at);
    expect(first.kind).toBe('change');
    const resumedNow: PackageTypeSellingState = { selling_stopped_at: null, revision: 5 };
    expect(planPackageTypeSelling(resumedNow, 5, 'ACTIVE', at)).toEqual({
      kind: 'unchanged',
      before: { selling_stopped_at: null, revision: 5 },
      after: { selling_stopped_at: null, revision: 5 },
    });
  });
});

describe('the read state handed to the transition', () => {
  it('leaves the read state untouched and copies it into the decision', () => {
    const current = Object.freeze({ selling_stopped_at: null, revision: 4 });
    const decision = planPackageTypeSelling(current, 4, 'STOPPED', at);
    expect(current).toEqual({ selling_stopped_at: null, revision: 4 });
    expect(decision.kind).toBe('change');
    if (decision.kind !== 'change') throw new Error('expected a change decision');
    expect(decision.before).not.toBe(current);
    expect(decision.after).not.toBe(decision.before);
    expect(decision.before).toEqual({ selling_stopped_at: null, revision: 4 });
  });

  it('does not write into the read state of a refused request', () => {
    const current = Object.freeze({ selling_stopped_at: null, revision: 4 });
    const decision = planPackageTypeSelling(current, 9, 'STOPPED', at);
    expect(decision.kind).toBe('revision-conflict');
    expect(current).toEqual({ selling_stopped_at: null, revision: 4 });
  });
});
