import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildUiTestEnvironment,
  collectCookies,
  fetchPendingDevicePages,
  matchDeviceLabel,
  summaryLines,
} from './orchestrate-counter-auth.mjs';

test('UI test environment excludes staging credentials and includes only its four spike values', () => {
  const config = { STAGING_UI_STAFF_PHONE: 'phone-fixture', STAGING_UI_STAFF_PIN: 'pin-fixture' };
  const env = buildUiTestEnvironment({ PATH: 'path-fixture', STAGING_UI_OWNER_PASSWORD: 'password-fixture' }, config, 'code-fixture', 'label-fixture');
  assert.equal(Object.keys(env).some((key) => key.startsWith('STAGING_UI_')), false);
  assert.deepEqual(
    [env.TEST_RUNNER_SPIKE_PAIRING_CODE, env.TEST_RUNNER_SPIKE_DEVICE_LABEL, env.TEST_RUNNER_SPIKE_STAFF_PHONE, env.TEST_RUNNER_SPIKE_STAFF_PIN],
    ['code-fixture', 'label-fixture', 'phone-fixture', 'pin-fixture'],
  );
});

test('cookie collection keeps every Set-Cookie name/value pair', () => {
  const headers = {
    getSetCookie: () => [
      'session=one; Path=/; HttpOnly; Secure',
      'preference=two; Path=/; SameSite=Lax',
      'not-a-cookie',
    ],
  };
  assert.equal(collectCookies(headers), 'session=one; preference=two');
});

test('label matching spans every page and requires exactly one match', () => {
  const pages = [
    { items: [{ id: 'first', label: 'another-device' }] },
    { items: [{ id: 'wanted', label: 'ci-device' }] },
  ];
  assert.equal(matchDeviceLabel(pages, 'ci-device'), 'wanted');
  assert.equal(matchDeviceLabel(pages, 'absent-device'), null);
  pages[1].items.push({ id: 'duplicate', label: 'ci-device' });
  assert.throws(() => matchDeviceLabel(pages, 'ci-device'), /duplicate device label/);
});

test('pending-device HTTP reads follow next_cursor through all pages', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    const cursor = parsed.searchParams.get('cursor');
    const body = cursor === null
      ? { items: [{ id: 'first', label: 'another-device' }], next_cursor: 'next-page' }
      : { items: [{ id: 'wanted', label: 'ci-device' }], next_cursor: null };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const config = { STAGING_UI_BRANCH_ID: 'branch-id', STAGING_UI_COMPANY_ID: 'company-id' };
  const pages = await fetchPendingDevicePages(fetchImpl, config, 'session=one');

  assert.equal(matchDeviceLabel(pages, 'ci-device'), 'wanted');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].parsed.searchParams.get('status'), 'pending');
  assert.equal(calls[0].parsed.searchParams.get('limit'), '100');
  assert.equal(calls[1].parsed.searchParams.get('cursor'), 'next-page');
  for (const call of calls) {
    assert.equal(call.options.headers.Cookie, 'session=one');
    assert.equal(call.options.headers['x-company-id'], 'company-id');
  }
});

test('summary lines contain only the fixed public outcomes', () => {
  assert.deepEqual(
    summaryLines({ owner: 'ok', pairing: 'issued', approval: 'approved', ui: 'passed', revoke: 'done' }),
    [
      'owner sign-in: ok',
      'pairing code: issued',
      'device approval: approved',
      'ui test: passed',
      'device revoke: done',
    ],
  );
  assert.deepEqual(
    summaryLines({ owner: 'failed', pairing: 'failed', approval: 'not found', ui: 'failed', revoke: 'skipped' }),
    [
      'owner sign-in: failed',
      'pairing code: failed',
      'device approval: not found',
      'ui test: failed',
      'device revoke: skipped',
    ],
  );
});
