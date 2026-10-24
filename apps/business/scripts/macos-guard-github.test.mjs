// نداءات GitHub بتاع الحارس: الشكل والمسار والـ method لكل نداء، من غير شبكة — الـ fetch
// متحقن فيه.
// التشغيل: node --test apps/business/scripts/macos-guard.test.mjs apps/business/scripts/macos-guard-github.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGithubIo } from './macos-guard-github.mjs';

const API = 'https://api.github.com';
const DAY_MS = 24 * 60 * 60 * 1000;

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const call = {
      url,
      method: options.method ?? 'GET',
      body: options.body === undefined ? undefined : JSON.parse(options.body),
    };
    calls.push(call);
    const response = handler(call, calls.length) ?? { status: 404, body: {} };
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    };
  };
  return { impl, calls };
}

function admissionBody(owner = '100/1/ios/staging') {
  return {
    status: 200,
    body: {
      message: JSON.stringify({ owner, leaseEnd: '2026-10-24T12:00:00.000Z' }),
    },
  };
}

function releasedBody() {
  return { status: 200, body: { message: JSON.stringify({ version: 1, released: true }) } };
}

function macosJobs(count) {
  const started = new Date().toISOString();
  const completed = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return Array.from({ length: count }, (_, index) => ({
    labels: ['macos-latest'],
    conclusion: 'success',
    started_at: started,
    completed_at: completed,
    id: index,
  }));
}

function runs(count, createdAt, firstId = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: firstId + index,
    run_attempt: 1,
    created_at: createdAt,
    updated_at: createdAt,
  }));
}

// نفس حدّ الـ io: أول الشهر ناقص 30 يوم (قاعدة إعادة تشغيل الـ run).
function creationBound() {
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return monthStart - 30 * DAY_MS;
}

describe('reading a slot', () => {
  it('reads a slot with the ref path and no refs/ prefix', async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.url.includes('/git/commits/')
        ? admissionBody()
        : { status: 200, body: { object: { sha: 'sha-1' } } },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', fetch: impl });
    const slot = await io.readSlot(1);
    assert.equal(calls[0].url, `${API}/repos/o/r/git/ref/mobile-guard/slot-1`);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].url, `${API}/repos/o/r/git/commits/sha-1`);
    assert.equal(slot.owner, '100/1/ios/staging');
    assert.equal(slot.sha, 'sha-1');
  });

  it('reads a missing slot as nothing', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 404, body: {} }));
    const io = createGithubIo({ token: 't', repository: 'o/r', fetch: impl });
    assert.equal(await io.readSlot(1), null);
    assert.equal(calls.length, 1);
  });

  it('reads a released slot as nothing', async () => {
    const { impl } = fakeFetch((call) =>
      call.url.includes('/git/commits/')
        ? releasedBody()
        : { status: 200, body: { object: { sha: 'sha-1' } } },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', fetch: impl });
    assert.equal(await io.readSlot(1), null);
  });
});

describe('creating and moving a slot', () => {
  it('creates a slot with the full ref name in the body', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 201, body: {} }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await io.createSlot(1, 'sha-2');
    assert.equal(calls[0].url, `${API}/repos/o/r/git/refs`);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { ref: 'refs/mobile-guard/slot-1', sha: 'sha-2' });
  });

  it('maps a 422 «already exists» to a conflict', async () => {
    const { impl } = fakeFetch((call) =>
      call.method === 'POST'
        ? { status: 422, body: { message: 'Reference already exists' } }
        : { status: 404, body: {} },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(
      () => io.createSlot(1, 'sha-2'),
      (error) => error.code === 'conflict',
    );
  });

  it('maps any other 422 to a plain error', async () => {
    const { impl } = fakeFetch((call) =>
      call.method === 'POST'
        ? { status: 422, body: { message: 'Reference name is empty' } }
        : { status: 404, body: {} },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(
      () => io.createSlot(1, 'sha-2'),
      (error) => error.code === undefined && error.message.includes('422'),
    );
  });

  it('moves a slot with PATCH and force false', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await io.moveSlot(1, 'sha-2');
    assert.equal(calls[0].url, `${API}/repos/o/r/git/refs/mobile-guard/slot-1`);
    assert.equal(calls[0].method, 'PATCH');
    assert.deepEqual(calls[0].body, { sha: 'sha-2', force: false });
  });

  it('maps a rejected move to a conflict', async () => {
    const { impl } = fakeFetch(() => ({ status: 422, body: { message: 'not a fast forward' } }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(
      () => io.moveSlot(1, 'sha-2'),
      (error) => error.code === 'conflict',
    );
  });
});

describe('creating an admission commit', () => {
  it('reuses the tree of the parent commit and never creates a tree', async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.method === 'POST'
        ? { status: 201, body: { sha: 'sha-new' } }
        : { status: 200, body: { tree: { sha: 'tree-1' } } },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    const payload = { owner: '100/1/ios/staging' };
    const sha = await io.createCommit(payload, 'parent-1');
    assert.equal(sha, 'sha-new');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${API}/repos/o/r/git/commits/parent-1`);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].url, `${API}/repos/o/r/git/commits`);
    assert.equal(calls[1].method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].body.message), payload);
    assert.equal(calls[1].body.tree, 'tree-1');
    assert.deepEqual(calls[1].body.parents, ['parent-1']);
    assert.ok(!calls.some((call) => call.url.includes('/git/trees')));
  });

  it('takes the head sha as the parent when there is no parent sha', async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.method === 'POST'
        ? { status: 201, body: { sha: 'sha-new' } }
        : { status: 200, body: { tree: { sha: 'tree-1' } } },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await io.createCommit({ owner: '100/1/ios/staging' }, null);
    assert.equal(calls[0].url, `${API}/repos/o/r/git/commits/head-1`);
    assert.deepEqual(calls[1].body.parents, ['head-1']);
  });

  it('refuses when the admission commit is rejected', async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.method === 'POST'
        ? { status: 422, body: { message: 'the tree is invalid' } }
        : { status: 200, body: { tree: { sha: 'tree-1' } } },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(
      () => io.createCommit({ owner: '100/1/ios/staging' }, 'parent-1'),
      (error) => error.message.includes('admission commit answered 422'),
    );
    assert.equal(calls.length, 2);
  });

  it('refuses when the parent commit cannot be read', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 404, body: {} }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(
      () => io.createCommit({ owner: '100/1/ios/staging' }, 'parent-1'),
      (error) => error.message.includes('parent commit answered 404'),
    );
    assert.equal(calls.length, 1);
  });

  it('refuses when the parent commit has no tree', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: { message: '{}' } }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(
      () => io.createCommit({ owner: '100/1/ios/staging' }, 'parent-1'),
      (error) => error.message.includes('the parent commit has no tree'),
    );
    assert.equal(calls.length, 1);
  });
});

describe('reading the macOS jobs', () => {
  it('reads the jobs of this workflow only, with filter=all and pagination', async () => {
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.includes('/actions/workflows/mobile.yml/runs')) {
        return {
          status: 200,
          body: { workflow_runs: [{ id: 5, created_at: new Date().toISOString() }] },
        };
      }
      if (call.url.includes('page=2')) return { status: 200, body: { jobs: macosJobs(1) } };
      return { status: 200, body: { jobs: macosJobs(100) } };
    });
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    const jobs = await io.listMacosJobs();
    assert.equal(
      calls[0].url,
      `${API}/repos/o/r/actions/workflows/mobile.yml/runs?per_page=100&page=1`,
    );
    assert.ok(calls[1].url.includes('/actions/runs/5/jobs?filter=all&per_page=100&page=1'));
    assert.ok(calls[2].url.includes('/actions/runs/5/jobs?filter=all&per_page=100&page=2'));
    assert.equal(jobs.length, 101);
  });

  it('stops on the first page that reaches the creation bound', async () => {
    const bound = creationBound();
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.includes('/actions/workflows/mobile.yml/runs')) {
        return {
          status: 200,
          body: { workflow_runs: runs(100, new Date(bound - DAY_MS).toISOString()) },
        };
      }
      return { status: 200, body: { jobs: [] } };
    });
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    assert.deepEqual(await io.listMacosJobs(), []);
    const runCalls = calls.filter((call) =>
      call.url.includes('/actions/workflows/mobile.yml/runs'),
    );
    assert.equal(runCalls.length, 1);
  });

  it('counts an old run that was re-run this month', async () => {
    const bound = creationBound();
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.includes('/actions/workflows/mobile.yml/runs')) {
        const page = call.url.includes('page=2') ? 2 : 1;
        const created = page === 1 ? bound + DAY_MS : bound - DAY_MS;
        const firstId = page === 1 ? 0 : 100;
        return {
          status: 200,
          body: { workflow_runs: runs(100, new Date(created).toISOString(), firstId) },
        };
      }
      return { status: 200, body: { jobs: macosJobs(1) } };
    });
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    const jobs = await io.listMacosJobs();
    const runCalls = calls.filter((call) =>
      call.url.includes('/actions/workflows/mobile.yml/runs'),
    );
    assert.equal(runCalls.length, 2);
    assert.ok(jobs.some((job) => job.runId === '100'));
  });

  it('refuses when ten pages are read and the bound is never reached', async () => {
    const bound = creationBound();
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.includes('/actions/workflows/mobile.yml/runs')) {
        return {
          status: 200,
          body: { workflow_runs: runs(100, new Date(bound + DAY_MS).toISOString()) },
        };
      }
      return { status: 200, body: { jobs: [] } };
    });
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(() => io.listMacosJobs(), /too long to read/);
    assert.equal(calls.length, 10);
  });
});
