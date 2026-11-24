// Unit tests for scripts/staging/commission-approval-trial.mjs — run with `node --test`.
// The script is imported (its main() only auto-runs when argv[1] is the script itself) and driven
// in-process against a real but in-process HTTP server on 127.0.0.1; global fetch is patched so the
// staging host the guard demands (api.staging.pospay.systems) is served by that fake API. process.exit
// is replaced by a sentinel error so refusals and failures are assertable without ending the test run.
// The fake API never stores or echoes credentials; the secret-visibility assertions read only the
// script's own stdout/stderr captured here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

import * as trial from './commission-approval-trial.mjs';

const HOST = 'api.staging.pospay.systems';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BUSINESS = '22222222-2222-4222-8222-222222222222';
const BRANCH = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'trial@example.test';
const PASSWORD = 'trial-password-9';
const COOKIE = 'pospay_stg_session=stub-cookie-value';
const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);
const periodOf = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

let uuidCounter = 0;
const fakeUuid = () => {
  const n = String((uuidCounter += 1)).padStart(12, '0');
  return `aaaaaaa${n.slice(0, 1)}-bbb1-4ccc-8ddd-${n}`;
};
const resetIds = () => { uuidCounter = 0; };

/** Minimal but real fake API: every endpoint the trial touches, with state the tests can bend. */
function fakeApiHandler(state) {
  const keyed = (store, request, response) => {
    const key = request.headers['idempotency-key'];
    const fingerprint = createHash('sha256').update(JSON.stringify(request.body ?? null)).digest('hex');
    if (store.has(key)) {
      if (store.get(key).fingerprint !== fingerprint) return { status: 422, json: { code: 'IDEMPOTENCY_KEY_REUSED' } };
      return store.get(key).response;
    }
    store.set(key, { fingerprint, response });
    return response;
  };
  const findOrCreate = (list, match, make) => list.find(match) ?? (list.push(make()), list[list.length - 1]);
  return function handler(request) {
    const { method } = request;
    const path = request.path.split('?')[0];
    const body = request.body;
    state.requests.push({ method, path: request.path, headers: request.headers, body });
    const json = (status, data, extra = {}) => ({ status, json: data, ...extra });
    if (method === 'POST' && path === '/v1/auth/sign-in/email') {
      if (body.email !== EMAIL || body.password !== PASSWORD) return json(401, { code: 'AUTHENTICATION_FAILED' });
      return json(200, { user: { id: 'u1' } }, { setCookie: [`${COOKIE}; Path=/; HttpOnly`] });
    }
    if (method === 'GET' && path === '/v1/me/workspaces') {
      return json(200, { companies: [{ id: COMPANY, name_ar: null, name_en: 'Trial Co', role_code: 'owner', scope: 'COMPANY', businesses: [{ id: BUSINESS, name_ar: null, name_en: 'Trial Biz', business_type: 'SALON', country: 'KW', branches: [{ id: BRANCH, name_ar: null, name_en: 'Main', effective_timezone: 'Asia/Kuwait', is_active: true }] }] }] });
    }
    let match;
    if ((match = path.match(/^\/v1\/businesses\/([^/]+)\/branches\/([^/]+)\/service-sessions\/(capabilities|recording-context)$/))) {
      if (match[3] === 'capabilities') return json(200, {});
      return json(200, { generated_at: '2026-11-24T10:00:00.000Z', business_timezone: 'Asia/Kuwait', recorder_membership_ids: ['m1'], recorder_membership_id: 'm1', discount_limit: { source: 'OWNER', bps: null } });
    }
    if ((match = path.match(/^\/v1\/businesses\/([^/]+)\/commissions\/periods\/([^/]+)\/estimate$/))) {
      const split = Math.max(state.employees.length, 1);
      const sourcesOf = (index) => (index === 0 ? Math.ceil(state.pricedTotal / split) : Math.floor(state.pricedTotal / split));
      const roster = state.employees.length === 0 && state.pricedTotal > 0
        ? [{ id: 'ghost', name_en: 'Legacy', index: 0 }]
        : state.employees.map((employee, index) => ({ ...employee, index }));
      const employees = roster.map((employee, index) => ({
        employee_id: employee.id, name_ar: null, name_en: employee.name_en, employee_number: 1, status: 'OK', partial: false,
        total: '0.000', sources: Array.from({ length: sourcesOf(index) }, () => ({ source_ref: 'x', kind: 'COMMISSION', amount: '1.000', source_branch_id: BRANCH, source_business_date: '2026-10-05', service_id: null, service_name: null })),
        sales: [], corrections: [], tips: { card: '0.000', cash: '0.000' }, carries: { commission: '0.000', tip_card: '0.000' },
      }));
      return json(200, { business_id: match[1], period: match[2], employees, partial: false, total: '0.000' });
    }
    if ((match = path.match(/^\/v1\/businesses\/([^/]+)\/commission-statements\/([^/]+)$/))) return json(200, { reader_scope: 'BUSINESS', business_id: match[1], period: match[2], status: state.statementStatus ?? 'DRAFT', generated: false });
    if (method === 'POST' && (match = path.match(/^\/v1\/businesses\/([^/]+)\/commission-statements\/([^/]+)\/generate$/))) {
      state.statementStatus = 'DRAFT';
      return keyed(state.generateKeys, request, json(200, { reader_scope: 'BUSINESS', business_id: match[1], period: match[2], status: 'DRAFT', current_fingerprint: FINGERPRINT_A, current_statement_fingerprint: FINGERPRINT_B, employees: [] }));
    }
    if (method === 'POST' && path.match(/^\/v1\/businesses\/([^/]+)\/commission-statements\/([^/]+)\/review$/)) {
      return keyed(state.reviewKeys, request, json(200, { status: 'REVIEWED', reviewed_fingerprint: FINGERPRINT_A, reviewed_statement_fingerprint: FINGERPRINT_B }));
    }
    if (path === `/v1/businesses/${BUSINESS}/services` && method === 'GET') return json(200, { items: state.services, next_cursor: null });
    if (path === `/v1/businesses/${BUSINESS}/services` && method === 'POST') {
      const service = { id: fakeUuid(), name_en: body.name_en, price: body.price };
      state.services.push(service);
      return json(201, service);
    }
    if (path === `/v1/businesses/${BUSINESS}/customers/find-or-create` && method === 'POST') {
      const customer = findOrCreate(state.customers, (c) => c.phone.national_number === body.phone.national_number, () => ({ id: fakeUuid(), ...body }));
      return json(200, customer);
    }
    if (path === `/v1/businesses/${BUSINESS}/employees` && method === 'GET') return json(200, { items: state.employees, next_cursor: null });
    if (path === `/v1/businesses/${BUSINESS}/employees` && method === 'POST') {
      const employee = { id: fakeUuid(), primary_branch_id: body.primary_branch_id, name_en: body.name_en, role_code: body.role_code, hire_date: body.hire_date, employee_number: state.employees.length + 1 };
      state.employees.push(employee);
      return json(201, employee);
    }
    if ((match = path.match(/^\/v1\/businesses\/[^/]+\/employees\/([^/]+)\/salaries$/)) && method === 'POST') {
      return keyed(state.salaryKeys, request, json(200, { id: fakeUuid(), employee_id: match[1], effective_from: body.effective_from, amount: body.amount, set_by: 'u1', revision: 1, reason: body.reason }));
    }
    if ((match = path.match(/^\/v1\/businesses\/[^/]+\/employees\/([^/]+)\/commission-plan-versions$/)) && method === 'POST') {
      return keyed(state.planKeys, request, json(201, { id: fakeUuid(), employee_id: match[1], version: 1, effective_from: body.effective_from, whole_period: body.whole_period, repair_period: null }));
    }
    if (method === 'POST' && path.match(/^\/v1\/businesses\/[^/]+\/branches\/[^/]+\/service-sessions$/)) {
      if (!state.workerPaused) state.pricedTotal += body.lines.length;
      const response = json(201, { outcome: 'ACCEPTED', session: { id: fakeUuid(), lines: body.lines.map((line, i) => ({ id: `line${i}`, ...line })) }, rejected_lines: [] });
      return keyed(state.sessionKeys, request, response);
    }
    return json(404, { code: 'NOT_FOUND' });
  };
}

/** Real in-process HTTP server; tests reach it through a patched fetch that rewrites the staging host. */
async function startFakeApi(handler) {
  resetIds();
  const state = { requests: [], employees: [], services: [], customers: [], pricedTotal: 0, workerPaused: false, statementStatus: null, salaryKeys: new Map(), planKeys: new Map(), sessionKeys: new Map(), generateKeys: new Map(), reviewKeys: new Map() };
  const inner = handler(state);
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const request = { method: req.method, path: req.url, headers: req.headers, body: raw === '' ? undefined : JSON.parse(raw) };
      const { status, json, setCookie } = inner(request);
      if (setCookie !== undefined) res.setHeader('set-cookie', setCookie);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    if (target.host !== HOST) return realFetch(url, init);
    const response = await realFetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, init);
    const cookies = response.headers.getSetCookie();
    const body = await response.text();
    return { status: response.status, headers: { getSetCookie: () => cookies }, json: async () => JSON.parse(body) };
  };
  return { state, stop: () => { globalThis.fetch = realFetch; return new Promise((resolve) => server.close(resolve)); } };
}

class Exit extends Error {
  constructor(code) { super(`process.exit(${code})`); this.code = code; }
}

function captureIo() {
  const original = { log: console.log, error: console.error, exit: process.exit };
  const out = [];
  // printf-style formatting, the way console itself renders '%s'/'%d' first arguments.
  const format = (...args) => {
    const [head, ...rest] = args;
    if (typeof head !== 'string' || !/%[sdifj]/.test(head)) return args.join(' ');
    let consumed = 0;
    const text = head.replace(/%[sdifj]/g, (spec) => (consumed < rest.length ? String(rest[consumed++]) : spec));
    return [text, ...rest.slice(consumed)].join(' ');
  };
  console.log = (...args) => out.push(format(...args));
  console.error = (...args) => out.push(format(...args));
  process.exit = (code) => { throw new Exit(code); };
  return {
    out,
    restore: () => { console.log = original.log; console.error = original.error; process.exit = original.exit; },
  };
}

async function runTrial(argv) {
  const io = captureIo();
  const originalArgv = process.argv;
  process.argv = ['node', 'trial.mjs', ...argv];
  let exitCode = 0;
  try {
    await trial.main();
  } catch (error) {
    if (error instanceof Exit) exitCode = error.code;
    else { io.out.push(`THROWN ${error?.name}: ${error?.message}`); exitCode = -1; }
  } finally {
    process.argv = originalArgv;
    io.restore();
  }
  return { out: io.out, exitCode };
}

async function withEnv(fn) {
  const previous = { email: process.env.TRIAL_EMAIL, password: process.env.TRIAL_PASSWORD };
  process.env.TRIAL_EMAIL = EMAIL;
  process.env.TRIAL_PASSWORD = PASSWORD;
  try { return await fn(); } finally { process.env.TRIAL_EMAIL = previous.email; process.env.TRIAL_PASSWORD = previous.password; }
}

const baseArgs = ['--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS, '--employees', '3', '--lines', '12', '--lines-per-session', '2', '--delay-ms', '0', '--poll-ms', '10', '--wait-timeout', '5'];
const stagedArgs = [...baseArgs, '--confirm-staging'];

/** Keys + body fingerprints per write route, in order — the resume contract of a re-run. */
function writeFootprint(state) {
  const collect = (store) => [...store.entries()].map(([key, entry]) => `${key}:${entry.fingerprint}`).sort();
  const sessions = state.requests.filter((r) => r.path.endsWith('/service-sessions') && r.method === 'POST');
  return JSON.stringify({
    sessions: sessions.map((r) => `${r.headers['idempotency-key']}:${createHash('sha256').update(JSON.stringify(r.body)).digest('hex')}`),
    salaries: collect(state.salaryKeys), plans: collect(state.planKeys),
    generate: collect(state.generateKeys), review: collect(state.reviewKeys),
    employees: state.employees.map((e) => e.name_en).sort(),
    services: state.services.map((s) => s.name_en).sort(),
    customers: state.customers.map((c) => c.phone.national_number).sort(),
  });
}

test('guard refuses every non-staging target, a missing confirm flag and non-uuid ids, before any request', async () => {
  const cases = [
    ['--api-url', 'http://localhost:3000', '--company', COMPANY, '--business', BUSINESS, '--confirm-staging'],
    ['--api-url', 'https://api.pospay.systems', '--company', COMPANY, '--business', BUSINESS, '--confirm-staging'],
    ['--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS],
    ['--api-url', `https://${HOST}`, '--company', 'not-a-uuid', '--business', BUSINESS, '--confirm-staging'],
    ['--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS, '--confirm-staging', '--period', '2026-13'],
  ];
  for (const argv of cases) {
    const { out, exitCode } = await runTrial(argv);
    assert.equal(exitCode, 2, argv.join(' '));
    assert.ok(out.join('\n').startsWith('refused:'), argv.join(' '));
  }
});

test('a full run creates the history, generates and reviews, and never calls enable/issue/approve routes', async () => {
  await withEnv(async () => {
    const api = await startFakeApi(fakeApiHandler);
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 0, out.join('\n'));
      const text = out.join('\n');
      assert.match(text, /review status REVIEWED/);
      assert.match(text, /sessions 6 lines 12\/12/);
      const paths = api.state.requests.map((r) => `${r.method} ${r.path}`);
      assert.ok(paths.includes('POST /v1/auth/sign-in/email'));
      for (const forbidden of ['approve', 'enable', 'coverage', 'issue', 'pay']) {
        assert.ok(!paths.some((p) => p.toLowerCase().includes(forbidden)), `forbidden route ${forbidden} was called`);
      }
      assert.ok(!text.includes(EMAIL), 'the email leaked into the output');
      assert.ok(!text.includes(PASSWORD), 'the password leaked into the output');
      assert.ok(!text.includes('stub-cookie-value'), 'the session cookie leaked into the output');
      assert.equal(api.state.statementStatus, 'DRAFT', 'review keeps the statement open for the operator');
      assert.ok(api.state.requests.some((r) => r.path.endsWith('/review')), 'review was called');
    } finally { await api.stop(); }
  });
});

test('a re-run derives the same deterministic run id, so it sends the same idempotency keys and bodies', async () => {
  await withEnv(async () => {
    const footprints = [];
    for (let run = 0; run < 2; run += 1) {
      const api = await startFakeApi(fakeApiHandler);
      try {
        const { exitCode } = await runTrial(stagedArgs);
        assert.equal(exitCode, 0);
        footprints.push(writeFootprint(api.state));
      } finally { await api.stop(); }
    }
    assert.equal(footprints[0], footprints[1]);
  });
});

test('the wait step times out cleanly when the worker has not consumed everything', async () => {
  await withEnv(async () => {
    const api = await startFakeApi(fakeApiHandler);
    api.state.workerPaused = true;
    try {
      const { out, exitCode } = await runTrial([...stagedArgs, '--wait-timeout', '1']);
      assert.equal(exitCode, 1);
      const text = out.join('\n');
      assert.match(text, /timeout: the estimate for \d{4}-\d{2} shows 0 of 12 consumed source\(s\)/);
      assert.match(text, /re-run the same command/);
    } finally { await api.stop(); }
  });
});

test('preflight refuses an existing non-DRAFT statement and pre-existing commission sources', async () => {
  await withEnv(async () => {
    for (const [setup, pattern] of [
      [(state) => { state.statementStatus = 'REVIEWED'; }, /statement .* is REVIEWED/],
      [(state) => { state.pricedTotal = 4; }, /already carries 4 commission source/],
    ]) {
      const api = await startFakeApi(fakeApiHandler);
      try {
        setup(api.state);
        const { out, exitCode } = await runTrial(stagedArgs);
        assert.equal(exitCode, 2);
        assert.match(out.join('\n'), pattern);
        const writes = api.state.requests.filter((r) => r.method === 'POST');
        assert.deepEqual(writes.map((r) => r.path), ['/v1/auth/sign-in/email'], 'no write happened');
      } finally { await api.stop(); }
    }
  });
});

test('period rules: the current month is not ended and anything older than last month is too old', async () => {
  await withEnv(async () => {
    const api = await startFakeApi(fakeApiHandler);
    try {
      const now = new Date();
      const current = periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)));
      const twoAgo = periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15)));
      const { out, exitCode } = await runTrial([...stagedArgs, '--period', current]);
      assert.equal(exitCode, 2);
      assert.match(out.join('\n'), /has not ended yet/);
      const older = await runTrial([...stagedArgs, '--period', twoAgo]);
      assert.equal(older.exitCode, 2);
      assert.match(older.out.join('\n'), /too old/);
    } finally { await api.stop(); }
  });
});

test('a non-retryable API failure prints method, route pattern, status and code only, then exits non-zero', async () => {
  await withEnv(async () => {
    const api = await startFakeApi((state) => {
      const inner = fakeApiHandler(state);
      return (request) => (request.method === 'POST' && /\/salaries$/.test(request.path) ? { status: 409, json: { code: 'SALARY_CONFLICT' } } : inner(request));
    });
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 1);
      const text = out.join('\n');
      assert.match(text, /ERROR POST \/v1\/businesses\/:businessId\/employees\/:employeeId\/salaries status=409 code=SALARY_CONFLICT/);
      assert.ok(!text.toLowerCase().includes('set-cookie'), 'no header printed');
    } finally { await api.stop(); }
  });
});

test('the script honors --dry-run: preflight only, then it stops before any write', async () => {
  await withEnv(async () => {
    const api = await startFakeApi(fakeApiHandler);
    try {
      const { out, exitCode } = await runTrial([...stagedArgs, '--dry-run']);
      assert.equal(exitCode, 0);
      assert.match(out.join('\n'), /dry-run: stopping before any write/);
      const writes = api.state.requests.filter((r) => r.method === 'POST');
      assert.deepEqual(writes.map((r) => r.path), ['/v1/auth/sign-in/email'], 'sign-in is the only POST');
    } finally { await api.stop(); }
  });
});

test('session bodies spread across the days of the period and all employees, deterministically', () => {
  const ctx = {
    period: '2026-10', timezone: 'Asia/Kuwait', days: 31, lines: 6, linesPerSession: 2, recorderMembershipId: 'm1',
    services: [{ id: 's1', price: '5.000' }, { id: 's2', price: '10.000' }],
    employees: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], customers: [{ id: 'c1' }, { id: 'c2' }],
  };
  const first = trial.sessionBody(0, ctx);
  const later = trial.sessionBody(15, ctx);
  assert.equal(first.occurred_at, '2026-10-01T12:00:00.000+03:00');
  assert.equal(later.occurred_at, '2026-10-16T12:00:00.000+03:00');
  assert.deepEqual(first.lines.map((line) => line.performers[0].employee_id), ['e1', 'e2']);
  assert.deepEqual(trial.sessionBody(0, ctx), first, 'bodies are deterministic for replay');
  assert.equal(trial.resolvePeriod('Asia/Kuwait', undefined), trial.previousPeriod('Asia/Kuwait').previous);
  const io = captureIo();
  let refused = null;
  try { trial.resolvePeriod('Asia/Kuwait', '2026-01'); } catch (error) { refused = error instanceof Exit ? error.code : null; }
  io.restore();
  assert.equal(refused, 2, 'an explicit period older than last month is refused');
  assert.equal(trial.daysInPeriod('2026-10'), 31);
  assert.equal(trial.shiftPeriod('2026-01', -1), '2025-12');
});
