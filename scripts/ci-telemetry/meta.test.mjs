import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMeta } from './meta.mjs';

const VALID = {
  GITHUB_SHA: 'a'.repeat(40),
  CI_TELEMETRY_PR_HEAD_SHA: 'b'.repeat(40),
  CI_TELEMETRY_PR_BASE_SHA: 'c'.repeat(40),
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_RUN_ID: '1234567890',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_JOB: 'api-tests',
  RUNNER_OS: 'Linux',
  RUNNER_ARCH: 'X64',
  CI_TELEMETRY_PNPM_VERSION: '10.15.0',
};

const FORBIDDEN = [
  'someone@example.com',
  '+00000000000',
  'FAKE_TOKEN_0000',
  '/home/runner/work/x',
  'C:\\Users\\x',
];

test('every known variable with a valid value reaches the meta', () => {
  const meta = buildMeta({ ...VALID }, 'v24.11.0');
  assert.deepEqual(Object.keys(meta).sort(), [
    'commit',
    'event',
    'job',
    'node',
    'pnpm',
    'prBase',
    'prHead',
    'runAttempt',
    'runId',
    'runnerArch',
    'runnerOs',
  ]);
  assert.equal(meta.commit, VALID.GITHUB_SHA);
  assert.equal(meta.prHead, VALID.CI_TELEMETRY_PR_HEAD_SHA);
  assert.equal(meta.pnpm, VALID.CI_TELEMETRY_PNPM_VERSION);
  assert.equal(meta.node, 'v24.11.0');
});

test('a forbidden value drops its key and never reaches the output', () => {
  for (const forbidden of FORBIDDEN) {
    const env = {};
    for (const key of Object.keys(VALID)) env[key] = forbidden;
    const meta = buildMeta(env, forbidden);
    assert.deepEqual(Object.keys(meta), []);
    const json = JSON.stringify(meta);
    for (const value of FORBIDDEN) assert.equal(json.includes(value), false, value);
  }
});

test('an unknown variable never reaches the meta', () => {
  const meta = buildMeta({ ...VALID, SOME_OTHER_VARIABLE: 'plain-value' }, 'v24.11.0');
  assert.equal(Object.keys(meta).includes('SOME_OTHER_VARIABLE'), false);
  assert.equal(JSON.stringify(meta).includes('plain-value'), false);
});

test('an absent variable is left out', () => {
  const meta = buildMeta({}, 'v24.11.0');
  assert.deepEqual(Object.keys(meta), ['node']);
});
