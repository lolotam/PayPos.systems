import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  buildUiTestEnvironment,
  collectCookies,
  fetchPendingDevicePages,
  matchDeviceLabel,
  run,
} from './orchestrate-counter-auth.mjs';

const OWNER_EMAIL = 'owner@example.test';
const OWNER_PASSWORD = 'owner-password-fixture';
const STAFF_PHONE = 'staff-phone-fixture';
const STAFF_PIN = 'staff-pin-fixture';
const OWNER_COOKIE = 'session=owner-cookie-fixture; preference=owner-cookie-other';
const PAIRING_CODE = 'pairing-code-fixture';
const BASE_TIME = Date.parse('2026-10-25T00:00:00.000Z');

const tempRoot = await mkdtemp(join(tmpdir(), 'pospay-counter-auth-'));
after(() => rm(tempRoot, { recursive: true, force: true }));

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

function fakeResponse({ status = 200, body = {}, cookies = [] }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { getSetCookie: () => cookies },
    json: async () => body,
  };
}

function fakeClock() {
  let current = BASE_TIME;
  return {
    now: () => current,
    sleep: (milliseconds) =>
      new Promise((resolve) => {
        current += milliseconds;
        setImmediate(resolve);
      }),
  };
}

function fakeChild({ ignoreSigterm = false } = {}) {
  const emitter = new EventEmitter();
  emitter.signals = [];
  emitter.kill = (signal) => {
    emitter.signals.push(signal);
    const dies = signal === 'SIGKILL' || (signal === 'SIGTERM' && !ignoreSigterm);
    if (dies) queueMicrotask(() => emitter.emit('close', null));
    return true;
  };
  emitter.finish = (code) => queueMicrotask(() => emitter.emit('close', code));
  return emitter;
}

/**
 * Harness للتشغيل كامل: شبكة وطفل وclock وlog كلهم وهمية. الـ options بتتحكم في
 * السلوك اللي الاختبار بيفحصه.
 */
function makeHarness(options = {}) {
  const clock = fakeClock();
  const state = { child: null, label: null, listCalls: 0, pollCalls: 0, calls: [], logs: [] };

  const pendingItems = () => {
    const items = [...(options.leftovers ?? [])];
    if (state.label !== null && options.runDevice !== false) {
      const label = options.lowercaseLabel === true ? state.label.toLowerCase() : state.label;
      items.push({ id: 'device-run', label, created_at: new Date(clock.now()).toISOString() });
    }
    return items;
  };

  const fetchImpl = async (url, fetchOptions = {}) => {
    const parsed = new URL(url);
    const call = {
      url: parsed,
      method: fetchOptions.method ?? 'GET',
      headers: fetchOptions.headers ?? {},
      body: fetchOptions.body,
    };
    state.calls.push(call);

    if (parsed.pathname === '/v1/auth/sign-in/email') {
      return fakeResponse({
        cookies: [
          'session=owner-cookie-fixture; Path=/; HttpOnly',
          'preference=owner-cookie-other; Path=/',
        ],
      });
    }
    if (parsed.pathname === '/v1/auth/sign-out') return fakeResponse({ status: 200 });
    if (parsed.pathname.endsWith('/devices/pairing-code')) {
      return fakeResponse({ body: { code: PAIRING_CODE } });
    }
    if (parsed.pathname.endsWith('/devices')) {
      state.listCalls += 1;
      if (state.child !== null) state.pollCalls += 1;
      // الفشل المتعمد بيخص جولات الاستطلاع بس: طلب الـ pending devices قبل الاقتران
      // (تنظيف بقايا تشغيلات مقتولة) السيرفر بيجاوب عليه عادي.
      const failures = options.pollFailures ?? 0;
      if (state.pollCalls > 0 && state.pollCalls <= failures) {
        throw new Error('the network is down');
      }
      return fakeResponse({ body: { items: pendingItems(), next_cursor: null } });
    }
    if (parsed.pathname.endsWith('/approve')) {
      if (options.approveFails === true) {
        state.child?.finish(1);
        return fakeResponse({ status: 500 });
      }
      state.child?.finish(options.uiExitCode ?? 0);
      return fakeResponse({ status: 204 });
    }
    if (parsed.pathname.endsWith('/revoke')) return fakeResponse({ status: 204 });
    throw new Error(`unexpected request ${call.method} ${parsed.pathname}`);
  };

  const spawnImpl = (command, args, spawnOptions) => {
    state.child = fakeChild({ ignoreSigterm: options.ignoreSigterm === true });
    state.label = spawnOptions.env.TEST_RUNNER_SPIKE_DEVICE_LABEL;
    options.onSpawn?.(state);
    return state.child;
  };

  const deps = {
    fetch: fetchImpl,
    spawn: spawnImpl,
    log: (line) => state.logs.push(line),
    now: clock.now,
    sleep: clock.sleep,
  };
  if (options.signal !== undefined) deps.signal = options.signal;

  return {
    state,
    deps,
    summary: (name) => state.logs.find((line) => line.startsWith(`${name}:`)),
    revokes: () => state.calls.filter((call) => call.url.pathname.endsWith('/revoke')),
    config: {
      STAGING_UI_OWNER_EMAIL: OWNER_EMAIL,
      STAGING_UI_OWNER_PASSWORD: OWNER_PASSWORD,
      STAGING_UI_STAFF_PHONE: STAFF_PHONE,
      STAGING_UI_STAFF_PIN: STAFF_PIN,
      STAGING_UI_COMPANY_ID: 'company-fixture',
      STAGING_UI_BRANCH_ID: 'branch-fixture',
      SPIKE_UDID: 'udid-fixture',
      RUNNER_TEMP: tempRoot,
      GITHUB_RUN_ID: '1234',
      GITHUB_RUN_ATTEMPT: '1',
    },
  };
}

test('a refused approval still leaves the device revoked', async () => {
  const harness = makeHarness({ approveFails: true });
  const code = await run(harness.config, harness.deps);

  assert.equal(code, 1);
  assert.equal(harness.summary('device approval'), 'device approval: failed');
  assert.equal(harness.summary('device revoke'), 'device revoke: done');
  assert.equal(harness.revokes().length, 1);
  assert.equal(harness.revokes()[0].url.pathname.endsWith('/device-run/revoke'), true);
});

test('a failed UI test exits with 1 and the device is revoked', async () => {
  const harness = makeHarness({ uiExitCode: 1 });
  const code = await run(harness.config, harness.deps);

  assert.equal(code, 1);
  assert.equal(harness.summary('ui test'), 'ui test: failed');
  assert.equal(harness.summary('device revoke'), 'device revoke: done');
  assert.equal(harness.revokes().length, 1);
});

test('an abort kills the child and the device is still revoked', async () => {
  const controller = new AbortController();
  const harness = makeHarness({
    signal: controller.signal,
    onSpawn: () => controller.abort(),
  });
  const code = await run(harness.config, harness.deps);

  assert.equal(code, 1);
  assert.equal(harness.state.child.signals.includes('SIGTERM'), true);
  assert.equal(harness.summary('device revoke'), 'device revoke: done');
  assert.equal(harness.revokes().length, 1);
});

test('a child that ignores SIGTERM is killed with SIGKILL', async () => {
  const controller = new AbortController();
  const harness = makeHarness({
    signal: controller.signal,
    ignoreSigterm: true,
    onSpawn: () => controller.abort(),
  });
  await run(harness.config, harness.deps);

  assert.deepEqual(harness.state.child.signals, ['SIGTERM', 'SIGKILL']);
});

test('one failed poll round is retried and the device is approved', async () => {
  const harness = makeHarness({ pollFailures: 1 });
  await run(harness.config, harness.deps);

  assert.equal(harness.summary('device approval'), 'device approval: approved');
  assert.equal(harness.summary('device revoke'), 'device revoke: done');
  assert.equal(harness.revokes().length, 1);
});

test('a label the server returns in another case still matches', async () => {
  const harness = makeHarness({ lowercaseLabel: true });
  await run(harness.config, harness.deps);

  assert.equal(harness.summary('device approval'), 'device approval: approved');
  assert.equal(harness.revokes().length, 1);
});

test('the leftover devices of a killed run are revoked before the new pairing', async () => {
  const old = new Date(BASE_TIME - 60 * 60_000).toISOString();
  const recent = new Date(BASE_TIME - 10 * 60_000).toISOString();
  const harness = makeHarness({
    leftovers: [
      { id: 'device-old', label: 'CI-IOS-999-1-ABCDEF', created_at: old },
      { id: 'device-fresh', label: 'CI-IOS-999-2-ABCDEF', created_at: recent },
      { id: 'device-other', label: 'salon-tablet', created_at: old },
    ],
  });
  await run(harness.config, harness.deps);

  assert.equal(harness.summary('leftover sweep'), 'leftover sweep: 1 revoked');
  const revokedIds = harness.revokes().map((call) => call.url.pathname.split('/').at(-2));
  assert.equal(revokedIds.includes('device-old'), true);
  assert.equal(revokedIds.includes('device-fresh'), false);
  assert.equal(revokedIds.includes('device-other'), false);
});

test('none of the fixture secrets reaches the log', async () => {
  const harness = makeHarness();
  await run(harness.config, harness.deps);

  // السطر الوحيد اللي مسموح فيه إن السر يبان فيه هو سطر الـ mask، لأنه هو اللي
  // بيقول لـ GitHub إنه يتحجب.
  const plain = harness.state.logs.filter((line) => !line.startsWith('::add-mask::'));
  for (const secret of [OWNER_PASSWORD, OWNER_COOKIE, PAIRING_CODE, STAFF_PHONE, STAFF_PIN]) {
    for (const line of plain) {
      assert.equal(line.includes(secret), false, `the log leaked a secret: ${line}`);
    }
  }
  // الـ cookie كله (رأسه وقيمته) ما بيتبانش في أي سطر، حتى في سطور الـ mask.
  assert.equal(
    harness.state.logs.some((line) => line.includes(OWNER_COOKIE)),
    false,
    'the owner cookie leaked into the log',
  );
  assert.equal(
    harness.state.logs.some((line) => line === `::add-mask::${PAIRING_CODE}`),
    true,
    'the pairing code was not masked',
  );
});

test('the run ends with the fixed summary lines and an owner sign-out', async () => {
  const harness = makeHarness();
  await run(harness.config, harness.deps);

  assert.deepEqual(harness.state.logs.slice(-7), [
    'owner sign-in: ok',
    'pairing code: issued',
    'device approval: approved',
    'ui test: passed',
    'device revoke: done',
    'owner sign-out: done',
    'leftover sweep: 0 revoked',
  ]);
  assert.equal(
    harness.state.calls.some(
      (call) => call.method === 'POST' && call.url.pathname === '/v1/auth/sign-out',
    ),
    true,
  );
});
