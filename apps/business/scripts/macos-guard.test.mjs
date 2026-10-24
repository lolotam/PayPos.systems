// القواعد الست بتاعت الحارس (ADR-0055 قرار 6) لازم كل واحدة فيهم تبان في اختبار: من غير
// شبكة ومن غير runner على macOS.
// التشغيل: node --test apps/business/scripts/macos-guard.test.mjs apps/business/scripts/macos-guard-github.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { configFromEnv, createGuard } from './macos-guard.mjs';

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const OWNER = '100/1/ios/staging';

function config(overrides = {}) {
  return {
    mode: 'enforce',
    runnerOs: 'Linux',
    owner: OWNER,
    run: '100/1',
    slots: 2,
    timeoutMinutes: 45,
    leaseMinutes: 120,
    allowanceMinutes: 1000,
    now: () => NOW,
    ...overrides,
  };
}

function lease(offsetMinutes) {
  return new Date(NOW + offsetMinutes * 60_000).toISOString();
}

function slot(index, owner, offsetMinutes = 60, sha = `sha-${index}`) {
  return { slot: index, owner, leaseEnd: lease(offsetMinutes), sha };
}

function finishedJob({ runId = '1', runAttempt = '1', minutes = 10 }) {
  return {
    runId,
    runAttempt,
    labels: ['macos-latest'],
    conclusion: 'success',
    startedAt: NOW - minutes * 60_000,
    completedAt: NOW,
  };
}

function runningJob({ runId = '1', runAttempt = '1' }) {
  return {
    runId,
    runAttempt,
    labels: ['macos-latest'],
    conclusion: null,
    startedAt: NOW - 60_000,
    completedAt: null,
  };
}

function createIo({ jobs = [], slots = new Map(), failures = {} } = {}) {
  const calls = [];
  const commits = new Map();
  let counter = 0;
  const refuse = (message) => {
    const error = new Error(message);
    error.code = 'conflict';
    return error;
  };
  return {
    calls,
    listMacosJobs: async () => {
      calls.push('listMacosJobs');
      if (failures.all || failures.jobs) throw new Error('the job history is unreadable');
      return jobs;
    },
    readSlot: async (index) => {
      calls.push(`readSlot:${index}`);
      if (failures.all || failures.read) throw new Error('the slot is unreadable');
      const current = slots.get(index);
      if (current === undefined || current.released === true) return null;
      return { slot: index, owner: current.owner, leaseEnd: current.leaseEnd, sha: current.sha };
    },
    createCommit: async (payload, parentSha) => {
      calls.push(`createCommit:${parentSha ?? 'head'}`);
      if (failures.all || failures.commit) throw new Error('the commit creation failed');
      counter += 1;
      const sha = `sha-new-${counter}`;
      commits.set(sha, { payload, parentSha });
      return sha;
    },
    createSlot: async (index, sha) => {
      calls.push(`createSlot:${index}`);
      if (failures.all || failures.create) throw new Error('the ref creation failed');
      if (slots.has(index)) {
        const current = slots.get(index);
        const error = refuse(`the slot ${index} is taken`);
        error.currentSha = current.sha;
        error.released = current.released === true;
        throw error;
      }
      slots.set(index, { slot: index, sha, ...commits.get(sha).payload });
    },
    moveSlot: async (index, sha) => {
      calls.push(`moveSlot:${index}`);
      if (failures.all || failures.move) throw new Error('the ref move failed');
      const current = slots.get(index);
      if (current === undefined) throw new Error(`the slot ${index} is gone`);
      const commit = commits.get(sha);
      if (failures.moved || commit.parentSha !== current.sha) {
        throw refuse(`the slot ${index} moved to another commit`);
      }
      slots.set(index, { slot: index, sha, ...commit.payload });
    },
  };
}

describe('the macOS guard on ubuntu (rule 1)', () => {
  it('refuses on any runner but ubuntu, without touching GitHub', async () => {
    const io = createIo({ failures: { all: true } });
    const result = await createGuard({ io, config: config({ runnerOs: 'macOS' }) }).admit();
    assert.equal(result.admitted, false);
    assert.deepEqual(io.calls, []);
  });

  it('public mode admits without touching GitHub', async () => {
    const io = createIo({ failures: { all: true } });
    const result = await createGuard({ io, config: config({ mode: 'public' }) }).admit();
    assert.equal(result.admitted, true);
    assert.equal(result.slot, null);
    assert.equal(result.count, null);
    assert.deepEqual(io.calls, []);
  });

  it('public mode accepts and releases without touching GitHub', async () => {
    const io = createIo({ failures: { all: true } });
    const guard = createGuard({ io, config: config({ mode: 'public' }) });
    assert.equal((await guard.accept()).accepted, true);
    assert.equal((await guard.release()).failed, false);
    assert.deepEqual(io.calls, []);
  });
});

describe('the monthly allowance (rule 4)', () => {
  it('refuses when the allowance leaves no room for the K slots', async () => {
    const io = createIo({});
    const result = await createGuard({
      io,
      config: config({ slots: 2, timeoutMinutes: 45, allowanceMinutes: 89 }),
    }).admit();
    assert.equal(result.admitted, false);
    assert.ok(!io.calls.some((call) => call.startsWith('createSlot')));
  });

  it('refuses when the monthly allowance is reached and takes no slot', async () => {
    const io = createIo({ jobs: [finishedJob({ minutes: 45 })] });
    const result = await createGuard({
      io,
      config: config({ slots: 1, timeoutMinutes: 45, allowanceMinutes: 45 }),
    }).admit();
    assert.equal(result.admitted, false);
    assert.equal(result.count, 45);
    assert.ok(!io.calls.some((call) => call.startsWith('createSlot')));
  });

  it('never lets two admissions together pass the allowance', async () => {
    const io = createIo({});
    const first = await createGuard({
      io,
      config: config({ slots: 2, timeoutMinutes: 45, allowanceMinutes: 90 }),
    }).admit();
    assert.equal(first.admitted, true);
    const second = await createGuard({
      io,
      config: config({
        owner: '100/1/ios/production',
        slots: 2,
        timeoutMinutes: 45,
        allowanceMinutes: 90,
      }),
    }).admit();
    assert.equal(second.admitted, false);
    assert.equal(second.count, 45);
  });
});

describe('the counting of the macOS minutes (rule 3)', () => {
  it('counts a slot held by another owner at its timeout', async () => {
    const io = createIo({ slots: new Map([[1, slot(1, '7/1/ios/staging')]]) });
    const result = await createGuard({
      io,
      config: config({ slots: 2, timeoutMinutes: 45, allowanceMinutes: 120 }),
    }).admit();
    assert.equal(result.count, 45);
    assert.equal(result.admitted, false);
  });

  it('does not count the queued jobs of the current run against it', async () => {
    const io = createIo({ jobs: [runningJob({ runId: '100', runAttempt: '1' })] });
    const result = await createGuard({
      io,
      config: config({ slots: 1, timeoutMinutes: 45, allowanceMinutes: 90 }),
    }).admit();
    assert.equal(result.count, 0);
    assert.equal(result.admitted, true);
  });

  it('counts the queued jobs of another run at their timeout', async () => {
    const io = createIo({ jobs: [runningJob({ runId: '7', runAttempt: '1' })] });
    const result = await createGuard({
      io,
      config: config({ slots: 1, timeoutMinutes: 45, allowanceMinutes: 80 }),
    }).admit();
    assert.equal(result.count, 45);
    assert.equal(result.admitted, false);
  });

  it('counts a finished job by its minutes and an admitted running job by its timeout, once each', async () => {
    const io = createIo({
      jobs: [finishedJob({ runId: '1', minutes: 2.5 }), runningJob({ runId: '2' })],
      slots: new Map([[1, slot(1, '2/1/ios/staging')]]),
    });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, true);
    assert.equal(result.count, 3 + 45);
  });
});

describe('the slots (rule 2)', () => {
  it('refuses when every slot is held', async () => {
    const io = createIo({
      slots: new Map([
        [1, slot(1, '7/1/ios/staging')],
        [2, slot(2, '7/1/ios/production')],
      ]),
    });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, false);
    assert.ok(!io.calls.some((call) => call.startsWith('createSlot')));
  });

  it('reclaims a slot whose lease expired', async () => {
    const slots = new Map([[1, slot(1, '7/1/ios/staging', -5)]]);
    const io = createIo({ slots });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, true);
    assert.equal(result.slot, 1);
    assert.equal(slots.get(1).owner, OWNER);
  });

  it('moves on when the reclaim loses the compare-and-swap', async () => {
    const slots = new Map([[1, slot(1, '7/1/ios/staging', -5)]]);
    const io = createIo({ slots, failures: { moved: true } });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, true);
    assert.equal(result.slot, 2);
    assert.equal(slots.get(2).owner, OWNER);
  });

  it('takes a released slot by the same compare-and-swap', async () => {
    const slots = new Map([[1, { slot: 1, sha: 'sha-tomb', released: true, version: 1 }]]);
    const io = createIo({ slots });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, true);
    assert.equal(result.slot, 1);
    assert.equal(slots.get(1).owner, OWNER);
  });

  it('refuses when the job history cannot be read', async () => {
    const io = createIo({ failures: { jobs: true } });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, false);
  });

  it('refuses when the ref creation fails', async () => {
    const io = createIo({ failures: { create: true } });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, false);
  });
});

describe('the acceptance (rule 5)', () => {
  it('accepts only the exact owner key', async () => {
    const io = createIo({ slots: new Map([[1, slot(1, '100/1/ios/production')]]) });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, false);
  });

  it('refuses an admission whose lease expired', async () => {
    const io = createIo({ slots: new Map([[1, slot(1, OWNER, -1)]]) });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, false);
  });

  it('accepts an unexpired admission of this job', async () => {
    const io = createIo({ slots: new Map([[1, slot(1, OWNER)]]) });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, true);
    assert.equal(result.slot, 1);
  });

  it('refuses an admission with less than the job timeout left', async () => {
    const io = createIo({ slots: new Map([[1, slot(1, OWNER, 44)]]) });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, false);
    assert.ok(result.reason.includes('44 minutes left'));
  });

  it('accepts an admission with exactly the job timeout left', async () => {
    const io = createIo({ slots: new Map([[1, slot(1, OWNER, 45)]]) });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, true);
  });

  it('refuses when the slot cannot be read on accept', async () => {
    const io = createIo({ failures: { read: true } });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, false);
  });
});

describe('the release (rule 2)', () => {
  it('releases its own slot only', async () => {
    const slots = new Map([
      [1, slot(1, OWNER)],
      [2, slot(2, '7/1/ios/staging')],
    ]);
    const io = createIo({ slots });
    const result = await createGuard({ io, config: config() }).release();
    assert.equal(result.released, true);
    assert.equal(result.slot, 1);
    assert.equal(slots.get(1).released, true);
    assert.equal(slots.has(2), true);
  });

  it('reports «not mine any more» without failing when the slot moved', async () => {
    const slots = new Map([[1, slot(1, OWNER)]]);
    const io = createIo({ slots, failures: { moved: true } });
    const result = await createGuard({ io, config: config() }).release();
    assert.equal(result.released, false);
    assert.equal(result.failed, false);
  });

  it('fails when the slot cannot be read on release', async () => {
    const io = createIo({ failures: { read: true } });
    const result = await createGuard({ io, config: config() }).release();
    assert.equal(result.released, false);
    assert.equal(result.failed, true);
  });
});

describe('the guard environment', () => {
  it('reads the mode, the owner key and the constants from the workflow environment', () => {
    const config = configFromEnv({
      MACOS_GUARD_MODE: 'public',
      RUNNER_OS: 'Linux',
      GITHUB_RUN_ID: '100',
      GITHUB_RUN_ATTEMPT: '2',
      MACOS_GUARD_JOB_KEY: 'ios',
      MACOS_GUARD_FLAVOUR: 'staging',
      MACOS_GUARD_SLOTS: '2',
      MACOS_GUARD_JOB_TIMEOUT_MINUTES: '45',
      MACOS_GUARD_LEASE_MINUTES: '120',
      MACOS_GUARD_ALLOWANCE_MINUTES: '180',
    });
    assert.equal(config.mode, 'public');
    assert.equal(config.runnerOs, 'Linux');
    assert.equal(config.owner, '100/2/ios/staging');
    assert.equal(config.run, '100/2');
    assert.equal(config.slots, 2);
    assert.equal(config.timeoutMinutes, 45);
    assert.equal(config.leaseMinutes, 120);
    assert.equal(config.allowanceMinutes, 180);
  });

  it('never guesses the mode: anything but public is enforce', () => {
    assert.equal(configFromEnv({ MACOS_GUARD_MODE: 'nonsense' }).mode, 'enforce');
    assert.equal(configFromEnv({}).mode, 'enforce');
  });
});
