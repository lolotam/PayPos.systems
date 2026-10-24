// node --test apps/business/scripts/macos-guard.test.mjs — القواعد الست بتاعت الحارس
// (ADR-0055 قرار 6) لازم كل واحدة فيهم تبان في اختبار: من غير شبكة ومن غير runner على macOS.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGuard } from './macos-guard.mjs';

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const OWNER = '100/1/ios/staging';

function config(overrides = {}) {
  return {
    mode: 'enforce',
    runnerOs: 'Linux',
    owner: OWNER,
    slots: 2,
    timeoutMinutes: 45,
    leaseMinutes: 120,
    allowanceMinutes: 120,
    now: () => NOW,
    ...overrides,
  };
}

function lease(offsetMinutes) {
  return new Date(NOW + offsetMinutes * 60_000).toISOString();
}

function slot(index, owner, offsetMinutes = 60) {
  return { slot: index, owner, leaseEnd: lease(offsetMinutes) };
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

function createIo({ jobs = [], slots = {}, failures = {} } = {}) {
  const calls = [];
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
      return slots[index] ?? null;
    },
    createSlot: async (index, admission) => {
      calls.push(`createSlot:${index}`);
      if (failures.all || failures.create) throw new Error('the ref creation failed');
      if (slots[index] !== undefined) {
        const error = new Error(`the slot ${index} is taken`);
        error.code = 'conflict';
        throw error;
      }
      slots[index] = { slot: index, ...admission };
    },
    deleteSlot: async (index) => {
      calls.push(`deleteSlot:${index}`);
      if (failures.all || failures.delete) throw new Error('the slot cannot be freed');
      if (slots[index] === undefined) {
        const error = new Error(`the slot ${index} is gone`);
        error.code = 'not-found';
        throw error;
      }
      delete slots[index];
    },
  };
}

describe('the macOS guard (ADR-0055 decision 6)', () => {
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

  it('refuses when the monthly allowance is reached and takes no slot', async () => {
    const io = createIo({ jobs: [finishedJob({ minutes: 45 })] });
    const result = await createGuard({
      io,
      config: config({ slots: 1, allowanceMinutes: 45 }),
    }).admit();
    assert.equal(result.admitted, false);
    assert.equal(result.count, 45);
    assert.ok(!io.calls.some((call) => call.startsWith('createSlot')));
  });

  it('refuses when every slot is held', async () => {
    const io = createIo({
      slots: { 1: slot(1, '7/1/ios/staging'), 2: slot(2, '7/1/ios/production') },
    });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, false);
    assert.ok(!io.calls.some((call) => call.startsWith('createSlot')));
  });

  it('reclaims a slot whose lease expired', async () => {
    const slots = { 1: slot(1, '7/1/ios/staging', -5) };
    const io = createIo({ slots });
    const result = await createGuard({ io, config: config() }).admit();
    assert.equal(result.admitted, true);
    assert.equal(result.slot, 1);
    assert.equal(slots[1].owner, OWNER);
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

  it('counts a finished job by its minutes and an admitted running job by its timeout, once each', async () => {
    const io = createIo({
      jobs: [finishedJob({ runId: '1', minutes: 2.5 }), runningJob({ runId: '2' })],
      slots: { 1: slot(1, '2/1/ios/staging') },
    });
    const result = await createGuard({
      io,
      config: config({ allowanceMinutes: 1000 }),
    }).admit();
    assert.equal(result.admitted, true);
    assert.equal(result.count, 3 + 45);
  });

  it('accepts only the exact owner key', async () => {
    const io = createIo({ slots: { 1: slot(1, '100/1/ios/production') } });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, false);
  });

  it('refuses an admission whose lease expired', async () => {
    const io = createIo({ slots: { 1: slot(1, OWNER, -1) } });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, false);
  });

  it('accepts an unexpired admission of this job', async () => {
    const io = createIo({ slots: { 1: slot(1, OWNER) } });
    const result = await createGuard({ io, config: config() }).accept();
    assert.equal(result.accepted, true);
    assert.equal(result.slot, 1);
  });

  it('releases its own slot only', async () => {
    const slots = { 1: slot(1, OWNER), 2: slot(2, '7/1/ios/staging') };
    const io = createIo({ slots });
    const result = await createGuard({ io, config: config() }).release();
    assert.equal(result.released, true);
    assert.equal(result.slot, 1);
    assert.equal(slots[1], undefined);
    assert.ok(slots[2] !== undefined);
  });
});
