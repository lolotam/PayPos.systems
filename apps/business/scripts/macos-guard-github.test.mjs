// node --test apps/business/scripts/ — نداءات GitHub بتاع الحارس: الشكل والمسار والـ method
// لكل نداء، من غير شبكة — الـ fetch متحقن فيه.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGithubIo } from './macos-guard-github.mjs';

const API = 'https://api.github.com';

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

function macosJobs(count) {
  return Array.from({ length: count }, (_, index) => ({
    labels: ['macos-latest'],
    conclusion: 'success',
    started_at: '2026-10-24T09:00:00.000Z',
    completed_at: '2026-10-24T09:10:00.000Z',
    id: index,
  }));
}

describe('the GitHub io of the macOS guard', () => {
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

  it('creates a slot with the full ref name in the body', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 201, body: {} }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await io.createSlot(1, 'sha-2');
    assert.equal(calls[0].url, `${API}/repos/o/r/git/refs`);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { ref: 'refs/mobile-guard/slot-1', sha: 'sha-2' });
  });

  it('maps a 422 «already exists» to a conflict', async () => {
    const { impl } = fakeFetch(() => ({
      status: 422,
      body: { message: 'Reference already exists' },
    }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(() => io.createSlot(1, 'sha-2'), (error) => error.code === 'conflict');
  });

  it('maps any other 422 to a plain error', async () => {
    const { impl } = fakeFetch(() => ({
      status: 422,
      body: { message: 'Reference name is empty' },
    }));
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

  it('deletes a slot with DELETE after re-reading it', async () => {
    const { impl, calls } = fakeFetch((call) =>
      call.method === 'DELETE'
        ? { status: 204, body: {} }
        : { status: 200, body: { object: { sha: 'sha-1' } } },
    );
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await io.deleteSlot(1, 'sha-1');
    assert.equal(calls[0].url, `${API}/repos/o/r/git/ref/mobile-guard/slot-1`);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].url, `${API}/repos/o/r/git/refs/mobile-guard/slot-1`);
    assert.equal(calls[1].method, 'DELETE');
  });

  it('refuses to delete a slot that moved to another commit', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: { object: { sha: 'sha-9' } } }));
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    await assert.rejects(
      () => io.deleteSlot(1, 'sha-1'),
      (error) => error.code === 'conflict',
    );
    assert.equal(calls.length, 1);
  });

  it('reads the jobs of this workflow only, with filter=all and pagination', async () => {
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.includes('/actions/workflows/mobile.yml/runs')) {
        return {
          status: 200,
          body: { workflow_runs: [{ id: 5, updated_at: new Date().toISOString() }] },
        };
      }
      if (call.url.includes('page=2')) return { status: 200, body: { jobs: macosJobs(1) } };
      return { status: 200, body: { jobs: macosJobs(100) } };
    });
    const io = createGithubIo({ token: 't', repository: 'o/r', headSha: 'head-1', fetch: impl });
    const jobs = await io.listMacosJobs();
    assert.equal(calls[0].url, `${API}/repos/o/r/actions/workflows/mobile.yml/runs?per_page=100&page=1`);
    assert.ok(calls[1].url.includes('/actions/runs/5/jobs?filter=all&per_page=100&page=1'));
    assert.ok(calls[2].url.includes('/actions/runs/5/jobs?filter=all&per_page=100&page=2'));
    assert.equal(jobs.length, 101);
  });
});
