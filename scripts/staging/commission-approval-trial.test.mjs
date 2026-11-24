// Unit tests for scripts/staging/commission-approval-trial.mjs — run with `node --test`.
// The script is imported (its main() only auto-runs when argv[1] is the script itself) and driven
// in-process against a real but in-process HTTP server; global fetch is patched so the exact
// staging origin the guard demands is served by that fake API, and ANY other host is refused by
// the patch itself (so a URL built from user input cannot reach the network). The fake API never
// echoes credentials; the secret-visibility assertions read only the script's own stdout/stderr
// captured here.

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
const GENERATED_AT = '2026-11-24T10:00:00.000Z';
const periodOf = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const fakeState = () => ({
  requests: [], employees: [], services: [], customers: [], pricedRefs: [], lineCounter: 0,
  workerPaused: false, statementStatus: null, ratingEnabled: false, redirectSignIn: false,
  failEmployeeCreates: 0, sessionRejectsLeft: 0, businessCreatedAt: '2026-01-15T10:00:00.000Z',
  salaryConflict: false, salaryCodeOverride: undefined, brokenEstimate: false,
  companyName: 'TRIAL-Commissions', businessName: 'TRIAL-Salon',
  salaryKeys: new Map(), planKeys: new Map(), sessionKeys: new Map(), generateKeys: new Map(), reviewKeys: new Map(),
});

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
    const { method, body } = request;
    const path = request.path.split('?')[0];
    state.requests.push({ method, path: request.path, headers: request.headers, body });
    const json = (status, data, extra = {}) => ({ status, json: data, ...extra });
    if (method === 'POST' && path === '/v1/auth/sign-in/email') {
      if (state.redirectSignIn) return { status: 307, json: {}, location: `http://127.0.0.1:1/elsewhere` };
      if (body.email !== EMAIL || body.password !== PASSWORD) return json(401, { code: 'AUTHENTICATION_FAILED' });
      return json(200, { user: { id: 'u1' } }, { setCookie: [`${COOKIE}; Path=/; HttpOnly`] });
    }
    if (method === 'GET' && path === '/v1/me/workspaces') {
      return json(200, { companies: [{ id: COMPANY, name_ar: null, name_en: state.companyName, role_code: 'owner', scope: 'COMPANY', businesses: [{ id: BUSINESS, name_ar: null, name_en: state.businessName, business_type: 'SALON', country: 'KW', branches: [{ id: BRANCH, name_ar: null, name_en: 'Main', effective_timezone: 'Asia/Kuwait', is_active: true }] }] }] });
    }
    if (method === 'GET' && path === '/v1/businesses') {
      return json(200, { items: [{ id: BUSINESS, company_id: COMPANY, name_en: state.businessName, created_at: state.businessCreatedAt }], next_cursor: null });
    }
    let match;
    if ((match = path.match(/^\/v1\/businesses\/([^/]+)\/branches\/([^/]+)\/service-sessions\/(capabilities|recording-context)$/))) {
      if (match[3] === 'capabilities') return json(200, {});
      return json(200, { generated_at: GENERATED_AT, business_timezone: 'Asia/Kuwait', recorder_membership_ids: ['m1'], recorder_membership_id: 'm1', discount_limit: { source: 'OWNER', bps: null } });
    }
    if ((match = path.match(/^\/v1\/businesses\/([^/]+)\/commissions\/periods\/([^/]+)\/estimate$/))) {
      if (state.brokenEstimate) return json(200, { business_id: match[1], period: match[2], employees: null, partial: false, total: '0.000' });
      const employees = state.employees.map((employee, index) => ({
        employee_id: employee.id, name_ar: null, name_en: employee.name_en, employee_number: 1, status: 'OK', partial: false,
        total: '0.000',
        sources: state.pricedRefs.filter((_, refIndex) => refIndex % state.employees.length === index)
          .map((ref) => ({ source_ref: ref, kind: 'COMMISSION', amount: '1.000', source_branch_id: BRANCH, source_business_date: '2026-10-05', service_id: null, service_name: null })),
        sales: [], corrections: [], tips: { card: '0.000', cash: '0.000' }, carries: { commission: '0.000', tip_card: '0.000' },
      }));
      return json(200, { business_id: match[1], period: match[2], employees, partial: false, total: '0.000' });
    }
    if ((match = path.match(/^\/v1\/businesses\/([^/]+)\/commission-statements\/([^/]+)$/))) return json(200, { reader_scope: 'BUSINESS', business_id: match[1], period: match[2], status: state.statementStatus ?? 'DRAFT', generated: false });
    if (method === 'GET' && path.match(/^\/v1\/businesses\/[^/]+\/rating-settings$/)) return json(200, { requests_enabled: state.ratingEnabled });
    if (method === 'POST' && (match = path.match(/^\/v1\/businesses\/([^/]+)\/commission-statements\/([^/]+)\/generate$/))) {
      state.statementStatus = 'DRAFT';
      return keyed(state.generateKeys, request, json(200, { reader_scope: 'BUSINESS', business_id: match[1], period: match[2], status: 'DRAFT', current_fingerprint: FINGERPRINT_A, current_statement_fingerprint: FINGERPRINT_B, employees: [] }));
    }
    if (method === 'POST' && path.match(/^\/v1\/businesses\/([^/]+)\/commission-statements\/([^/]+)\/review$/)) {
      return keyed(state.reviewKeys, request, json(200, { status: 'REVIEWED', reviewed_fingerprint: FINGERPRINT_A, reviewed_statement_fingerprint: FINGERPRINT_B }));
    }
    if (path === `/v1/businesses/${BUSINESS}/services` && method === 'GET') return json(200, { items: state.services, next_cursor: null });
    if (path === `/v1/businesses/${BUSINESS}/services` && method === 'POST') {
      const service = { id: fakeUuid(state), name_en: body.name_en, price: body.price };
      state.services.push(service);
      return json(201, service);
    }
    if (path === `/v1/businesses/${BUSINESS}/customers/find-or-create` && method === 'POST') {
      const customer = findOrCreate(state.customers, (c) => c.phone.national_number === body.phone.national_number, () => ({ id: fakeUuid(state), ...body }));
      return json(200, customer);
    }
    if (path === `/v1/businesses/${BUSINESS}/employees` && method === 'GET') return json(200, { items: state.employees, next_cursor: null });
    if (path === `/v1/businesses/${BUSINESS}/employees` && method === 'POST') {
      // The create commits on the server even when its answer is lost: the row is stored before the status.
      const employee = findOrCreate(state.employees, (e) => e.name_en === body.name_en, () => ({
        id: fakeUuid(state), primary_branch_id: body.primary_branch_id, name_en: body.name_en, role_code: body.role_code, hire_date: body.hire_date, employee_number: state.employees.length + 1,
      }));
      if (state.failEmployeeCreates > 0) { state.failEmployeeCreates -= 1; return json(500, { code: 'INTERNAL_ERROR' }); }
      return json(201, employee);
    }
    if ((match = path.match(/^\/v1\/businesses\/[^/]+\/employees\/([^/]+)\/salaries$/)) && method === 'POST') {
      if (state.salaryConflict) {
        const leaky = { code: 'SALARY_CONFLICT', message_en: `leak ${EMAIL} ${PASSWORD} ${COOKIE} ${body.amount}` };
        return keyed(state.salaryKeys, request, json(409, leaky));
      }
      if (state.salaryCodeOverride !== undefined) return { status: 409, json: { code: state.salaryCodeOverride } };
      return keyed(state.salaryKeys, request, json(200, { id: fakeUuid(state), employee_id: match[1], effective_from: body.effective_from, amount: body.amount, set_by: 'u1', revision: 1, reason: body.reason }));
    }
    if ((match = path.match(/^\/v1\/businesses\/[^/]+\/employees\/([^/]+)\/commission-plan-versions$/)) && method === 'POST') {
      return keyed(state.planKeys, request, json(201, { id: fakeUuid(state), employee_id: match[1], version: 1, effective_from: body.effective_from, whole_period: body.whole_period, repair_period: null }));
    }
    if (method === 'POST' && path.match(/^\/v1\/businesses\/[^/]+\/branches\/[^/]+\/service-sessions$/)) {
      if (state.sessionRejectsLeft > 0) {
        state.sessionRejectsLeft -= 1;
        return keyed(state.sessionKeys, request, json(201, { outcome: 'PARTIAL', session: { id: fakeUuid(state), lines: [] }, rejected_lines: [{ input_index: 0, code: 'SESSION_DISCOUNT_ABOVE_LIMIT' }] }));
      }
      state.lineCounter += body.lines.length;
      if (!state.workerPaused) {
        for (let i = body.lines.length; i > 0; i -= 1) state.pricedRefs.push(`line:L${state.lineCounter - i + 1}`);
      }
      const lines = body.lines.map((line, i) => ({ id: `L${state.lineCounter - body.lines.length + i + 1}`, ...line }));
      return keyed(state.sessionKeys, request, json(201, { outcome: 'ACCEPTED', session: { id: fakeUuid(state), lines }, rejected_lines: [] }));
    }
    return json(404, { code: 'NOT_FOUND' });
  };
}

let uuidCounter = 0;
const fakeUuid = (state) => {
  const n = String((state === undefined ? (uuidCounter += 1) : (state.nextId = (state.nextId ?? 0) + 1))).padStart(12, '0');
  return `aaaaaaa${n.slice(0, 1)}-bbb1-4ccc-8ddd-${n}`;
};

/** Real in-process HTTP server; tests reach it through a patched fetch that rewrites the staging host. */
async function startFakeApi(state = fakeState()) {
  const inner = fakeApiHandler(state);
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const request = { method: req.method, path: req.url, headers: req.headers, body: raw === '' ? undefined : JSON.parse(raw) };
      const { status, json, setCookie, location } = inner(request);
      if (setCookie !== undefined) res.setHeader('set-cookie', setCookie);
      if (location !== undefined) res.setHeader('location', location);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    if (target.host !== HOST) throw new Error(`blocked non-staging fetch: ${url}`);
    const response = await realFetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, init);
    const cookies = response.headers.getSetCookie();
    const body = await response.text();
    return { status: response.status, headers: { getSetCookie: () => cookies }, json: async () => JSON.parse(body) };
  };
  return { state, stop: () => { globalThis.fetch = realFetch; return new Promise((resolve) => server.close(resolve)); } };
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

/** A fetch that reaches nothing: it records the attempt and refuses every host. */
function blockedFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error('blocked fetch'); };
  return { calls, stop: () => { globalThis.fetch = original; } };
}

class Exit extends Error {
  constructor(code) { super(`process.exit(${code})`); this.code = code; }
}

async function runTrial(argv) {
  const io = captureIo();
  const originalArgv = process.argv;
  process.argv = ['node', 'trial.mjs', ...argv];
  process.exitCode = 0;
  let exitCode;
  try {
    await trial.main();
    exitCode = process.exitCode ?? 0;
  } catch (error) {
    if (error instanceof Exit) exitCode = error.code;
    else { io.out.push(`THROWN ${error?.name}: ${error?.message}`); exitCode = -1; }
  } finally {
    process.argv = originalArgv;
    process.exitCode = 0;
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

const baseArgs = ['--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS, '--employees', '3', '--lines', '12', '--lines-per-session', '2', '--delay-ms', '0', '--poll-ms', '10', '--wait-timeout', '5', '--retry-backoff-ms', '1'];
const stagedArgs = [...baseArgs, '--confirm-staging', '--notifications-off-confirmed'];
const FORBIDDEN = ['approve', 'return', 'mark-paid', 'enable', 'coverage', 'issue', 'pay'];

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

const assertNeverApproves = (state, label) => {
  const paths = state.requests.map((r) => `${r.method} ${r.path}`);
  for (const forbidden of FORBIDDEN) {
    assert.ok(!paths.some((p) => p.toLowerCase().includes(forbidden)), `${label}: forbidden route ${forbidden} was called`);
  }
};

test('guard refuses every non-staging target, a missing confirm flag and non-uuid ids, before any request', async () => {
  const bad = (url) => ['--api-url', url, '--company', COMPANY, '--business', BUSINESS, '--confirm-staging', '--notifications-off-confirmed'];
  const cases = [
    bad(`http://${HOST}`), // plain http: credentials would travel in the clear
    bad(`https://user:pw@${HOST}`), // userinfo
    bad(`https://${HOST}:443`), // explicit port
    bad(`https://${HOST}:8443`), // wrong port
    bad(`https://${HOST}.`), // trailing dot host
    bad(`https://API.STAGING.POSPAY.SYSTEMS`), // upper-case host
    bad(`https://${HOST}/v1`), // path beyond the bare origin
    bad(`https://${HOST}/?x=1`), // query
    ['--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS, '--confirm-staging', '--notifications-off-confirmed'],
    ['--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS, '--confirm-staging'],
    ['--api-url', `https://${HOST}`, '--company', 'not-a-uuid', '--business', BUSINESS, '--confirm-staging', '--notifications-off-confirmed'],
    ['--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS, '--confirm-staging', '--notifications-off-confirmed', '--period', '2026-13'],
  ];
  for (const argv of cases) {
    const blocked = blockedFetch();
    try {
      const { out, exitCode } = await runTrial(argv);
      assert.equal(exitCode, 2, argv.join(' '));
      assert.ok(out.join('\n').startsWith('refused:'), argv.join(' '));
      assert.deepEqual(blocked.calls, [], `no request may leave the script: ${argv.join(' ')}`);
    } finally { blocked.stop(); }
  }
});

test('the notifications flag is required and the refusal names the operator action', async () => {
  const { out, exitCode } = await runTrial([
    '--api-url', `https://${HOST}`, '--company', COMPANY, '--business', BUSINESS, '--confirm-staging',
  ]);
  assert.equal(exitCode, 2);
  assert.match(out.join('\n'), /--notifications-off-confirmed is required/);
  assert.match(out.join('\n'), /rating and notification messages OFF/);
});

test('a redirecting sign-in is never followed and never resends the body elsewhere', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    api.state.redirectSignIn = true;
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 1, out.join('\n'));
      assert.match(out.join('\n'), /NETWORK_ERROR/);
      assert.ok(!api.state.requests.some((r) => r.path.includes('/elsewhere')), 'the redirect target was contacted');
      assertNeverApproves(api.state, 'redirect');
    } finally { await api.stop(); }
  });
});

test('the dedicated-test-company marker: company and business names must start with TRIAL-', async () => {
  await withEnv(async () => {
    for (const [field, value] of [['companyName', 'Production Salon Co'], ['businessName', 'Downtown Branch']]) {
      const api = await startFakeApi();
      api.state[field] = value;
      try {
        const { out, exitCode } = await runTrial(stagedArgs);
        assert.equal(exitCode, 2);
        assert.match(out.join('\n'), /TRIAL-/);
        assert.ok(!api.state.requests.some((r) => r.method === 'POST' && r.path !== '/v1/auth/sign-in/email'), 'no write before the marker check');
      } finally { await api.stop(); }
    }
  });
});

test('the company and the business must both exist under the signed-in user, and the business under the company', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    const withOption = (name, value) => {
      const argv = [...stagedArgs];
      argv[argv.indexOf(name) + 1] = value;
      return argv;
    };
    const other = '99999999-9999-4999-8999-999999999999';
    try {
      const wrongCompany = await runTrial(withOption('--company', other));
      assert.equal(wrongCompany.exitCode, 2);
      assert.match(wrongCompany.out.join('\n'), /no membership in company/);
      const wrongBusiness = await runTrial(withOption('--business', other));
      assert.equal(wrongBusiness.exitCode, 2);
      assert.match(wrongBusiness.out.join('\n'), /not part of company/);
      // x-company-id is always the company of that run — never another one.
      const headers = api.state.requests.map((r) => r.headers['x-company-id']);
      assert.ok(headers.includes(COMPANY), 'the company run sent its own company id');
      assert.ok(headers.includes(other), 'the other-company run sent that other company id');
      assert.deepEqual([...new Set(headers)].sort(), [COMPANY, other].sort(), 'no run ever sent a third company id');
    } finally { await api.stop(); }
  });
});

test('customer phones come from the NANP fictional block and pass the API phone normalisation rules', () => {
  // Re-implementation of apps/api/src/modules/customers/domain/phone.ts normalizePhone rules.
  const normalize = (phone) => {
    assert.match(phone.calling_code, /^[1-9][0-9]{0,2}$/);
    assert.match(phone.national_number, /^[0-9 ().-]+$/);
    const national = phone.national_number.replace(/[ ().-]/g, '').replace(/^0+/, '');
    const normalized = `+${phone.calling_code}${national}`;
    assert.ok(national.length > 0);
    if (phone.calling_code === '965') assert.equal(national.length, 8);
    assert.match(normalized, /^\+[1-9][0-9]{1,14}$/);
    return normalized;
  };
  const phones = Array.from({ length: 20 }, (_, i) => ({ calling_code: '1', national_number: String(2025550100 + i) }));
  for (const phone of phones) {
    const normalized = normalize(phone);
    assert.match(normalized, /^\+1202555(01|02)\d\d$/, 'the NANP fictional 202-555-0100..0119 block');
  }
  assert.equal(phones[0].national_number, '2025550100');
  assert.equal(phones[19].national_number, '2025550119');
});

test('a full run creates the history, generates and reviews, and never calls a closing route', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 0, out.join('\n'));
      const text = out.join('\n');
      assert.match(text, /review status REVIEWED/);
      assert.match(text, /sessions 6 lines 12\/12/);
      assert.ok(api.state.requests.some((r) => r.path.endsWith('/review')), 'review was called');
      assert.equal(api.state.statementStatus, 'DRAFT', 'review keeps the statement open for the operator');
      assertNeverApproves(api.state, 'full run');
      assert.ok(!text.includes(EMAIL), 'the email leaked into the output');
      assert.ok(!text.includes(PASSWORD), 'the password leaked into the output');
      assert.ok(!text.includes('stub-cookie-value'), 'the session cookie leaked into the output');
    } finally { await api.stop(); }
  });
});

test('a re-run derives the same body-hashed idempotency keys, so it replays and never re-creates', async () => {
  await withEnv(async () => {
    const footprints = [];
    for (let run = 0; run < 2; run += 1) {
      const api = await startFakeApi();
      try {
        const { exitCode } = await runTrial(stagedArgs);
        assert.equal(exitCode, 0);
        footprints.push(writeFootprint(api.state));
      } finally { await api.stop(); }
    }
    assert.equal(footprints[0], footprints[1]);
  });
});

test('the run id carries the period and the options, so different options can never replay one key', async () => {
  const base = { employees: 3, lines: 12, linesPerSession: 2 };
  const id = trial.runIdOf(base, '2026-10');
  assert.equal(id, trial.runIdOf({ ...base }, '2026-10'));
  assert.notEqual(id, trial.runIdOf({ ...base, employees: 4 }, '2026-10'));
  assert.notEqual(id, trial.runIdOf({ ...base, lines: 20 }, '2026-10'));
  assert.notEqual(id, trial.runIdOf({ ...base, linesPerSession: 3 }, '2026-10'));
  assert.notEqual(id, trial.runIdOf(base, '2026-09'));
  assert.match(id, /^[0-9a-f]{16}$/);
});

test('resume: existing trial sources pass preflight only with --resume, owned by trial employees', async () => {
  await withEnv(async () => {
    const seeded = fakeState();
    const runId = trial.runIdOf({ employees: 3, lines: 12, linesPerSession: 2 }, '2026-10');
    for (let i = 0; i < 3; i += 1) {
      seeded.employees.push({
        id: fakeUuid(seeded), primary_branch_id: BRANCH, name_en: trial.trialEmployeeName(i, runId),
        role_code: 'staff', hire_date: '2026-10-01',
      });
    }
    seeded.pricedRefs.push('line:R1', 'line:R2', 'line:R3', 'line:R4');
    const first = await startFakeApi(seeded);
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 2);
      assert.match(out.join('\n'), /--resume/);
      assertNeverApproves(first.state, 'resume refusal');
    } finally { await first.stop(); }
    const second = await startFakeApi(structuredClone(seeded));
    try {
      const { exitCode, out } = await runTrial([...stagedArgs, '--resume']);
      assert.equal(exitCode, 0, out.join('\n'));
      assertNeverApproves(second.state, 'resume');
      const employeeCreates = second.state.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/employees'));
      assert.equal(employeeCreates.length, 0, 'existing trial employees are reused, never re-created');
    } finally { await second.stop(); }
  });
});

test('resume refuses sources owned by a non-trial employee and a trial created with other options', async () => {
  await withEnv(async () => {
    const foreign = fakeState();
    foreign.employees.push({ id: fakeUuid(foreign), primary_branch_id: BRANCH, name_en: 'Real Employee', role_code: 'staff', hire_date: '2026-10-01' });
    foreign.pricedRefs.push('line:F1');
    const api = await startFakeApi(foreign);
    try {
      const { out, exitCode } = await runTrial([...stagedArgs, '--resume']);
      assert.equal(exitCode, 2);
      assert.match(out.join('\n'), /non-trial employee/);
      assert.ok(out.join('\n').includes(foreign.employees[0].id), 'the refusing employee id is shown');
    } finally { await api.stop(); }
    const otherOptions = fakeState();
    const otherRunId = trial.runIdOf({ employees: 3, lines: 99, linesPerSession: 2 }, '2026-10');
    otherOptions.employees.push({ id: fakeUuid(otherOptions), primary_branch_id: BRANCH, name_en: trial.trialEmployeeName(0, otherRunId), role_code: 'staff', hire_date: '2026-10-01' });
    otherOptions.pricedRefs.push('line:O1');
    const other = await startFakeApi(otherOptions);
    try {
      const { out, exitCode } = await runTrial([...stagedArgs, '--resume']);
      assert.equal(exitCode, 2);
      assert.match(out.join('\n'), /different options detected/);
    } finally { await other.stop(); }
  });
});

test('an un-keyed create whose answer was lost is recovered by re-listing, not duplicated', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    api.state.failEmployeeCreates = 5; // the create commits but every one of the five answers is a 500
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 0, out.join('\n'));
      const names = api.state.employees.map((e) => e.name_en);
      assert.equal(new Set(names).size, names.length, 'no duplicate employee');
      assert.equal(names.length, 3, 'every trial employee exists exactly once');
    } finally { await api.stop(); }
  });
});

test('the wait step times out cleanly when the worker has not consumed everything', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    api.state.workerPaused = true;
    try {
      const { out, exitCode } = await runTrial([...stagedArgs, '--wait-timeout', '1']);
      assert.equal(exitCode, 1);
      const text = out.join('\n');
      assert.match(text, /timeout: 0 of 12 recorded line\(s\) are priced/);
      assert.match(text, /re-run the same command/);
      assertNeverApproves(api.state, 'timeout');
    } finally { await api.stop(); }
  });
});

test('preflight refuses a non-DRAFT statement, rating requests on, and a business created after the target month', async () => {
  await withEnv(async () => {
    const cases = [
      [(state) => { state.statementStatus = 'REVIEWED'; }, /statement .* is REVIEWED/],
      [(state) => { state.ratingEnabled = true; }, /rating requests are enabled/],
      [(state) => { state.businessCreatedAt = '2026-11-02T00:00:00.000Z'; }, /COMMISSION_PERIOD_BEFORE_BUSINESS/],
    ];
    for (const [setup, pattern] of cases) {
      const api = await startFakeApi();
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

test('a rejected service line stops the run with the session index and codes, before generate or review', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    api.state.sessionRejectsLeft = 1;
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 1);
      const text = out.join('\n');
      assert.match(text, /rejected lines in session 0: SESSION_DISCOUNT_ABOVE_LIMIT/);
      assert.ok(!api.state.requests.some((r) => r.path.endsWith('/generate') || r.path.endsWith('/review')), 'generate and review never ran');
      assertNeverApproves(api.state, 'rejected line');
    } finally { await api.stop(); }
  });
});

test('period rules: the current month is not ended and anything older than last month is too old', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    try {
      const now = new Date(GENERATED_AT);
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

test('a non-retryable API failure prints method, route pattern, status and a clean code only, never a body', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    api.state.salaryConflict = true; // the fake salary route answers 409 with a body that carries the secrets
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 1);
      const text = out.join('\n');
      assert.match(text, /ERROR POST \/v1\/businesses\/:businessId\/employees\/:employeeId\/salaries status=409 code=SALARY_CONFLICT/);
      assert.ok(!text.includes(EMAIL), 'the email leaked from a failing response body');
      assert.ok(!text.includes(PASSWORD), 'the password leaked from a failing response body');
      assert.ok(!text.includes('stub-cookie-value'), 'a cookie-like string leaked from a failing response body');
      assert.ok(!text.toLowerCase().includes('set-cookie'), 'no header printed');
      assertNeverApproves(api.state, 'failure');
    } finally { await api.stop(); }
  });
});

test('an API code that is not a catalogue code prints as UNKNOWN', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    api.state.salaryCodeOverride = 'oops-lowercase';
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 1);
      assert.match(out.join('\n'), /status=409 code=UNKNOWN/);
    } finally { await api.stop(); }
  });
});

test('an unexpected exception prints a fixed line and the error class, never the message', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    api.state.brokenEstimate = true; // the estimate read answers a shape the script never expected
    try {
      const { out, exitCode } = await runTrial(stagedArgs);
      assert.equal(exitCode, 1);
      const text = out.join('\n');
      assert.match(text, /unexpected failure: TypeError/);
      assert.ok(!text.includes('Cannot read'), 'the error message leaked');
      assert.ok(!text.includes(EMAIL), 'the email leaked from an unexpected error');
      assert.ok(!text.includes(PASSWORD), 'the password leaked from an unexpected error');
      assert.ok(!text.includes('stub-cookie-value'), 'a cookie-like string leaked from an unexpected error');
    } finally { await api.stop(); }
  });
});

test('the script honors --dry-run: preflight only, then it stops before any write', async () => {
  await withEnv(async () => {
    const api = await startFakeApi();
    try {
      const { out, exitCode } = await runTrial([...stagedArgs, '--dry-run']);
      assert.equal(exitCode, 0);
      assert.match(out.join('\n'), /dry-run: stopping before any write/);
      const writes = api.state.requests.filter((r) => r.method === 'POST');
      assert.deepEqual(writes.map((r) => r.path), ['/v1/auth/sign-in/email'], 'sign-in is the only POST');
    } finally { await api.stop(); }
  });
});

test('no route of a success, a failing and a resumed run ever approves, returns, marks paid or enables', async () => {
  await withEnv(async () => {
    const success = await startFakeApi();
    try {
      assert.equal((await runTrial(stagedArgs)).exitCode, 0);
      assertNeverApproves(success.state, 'success');
    } finally { await success.stop(); }
    const failing = await startFakeApi();
    try {
      failing.state.salaryConflict = true;
      assert.equal((await runTrial(stagedArgs)).exitCode, 1);
      assertNeverApproves(failing.state, 'failing');
    } finally { await failing.stop(); }
    const seeded = fakeState();
    const runId = trial.runIdOf({ employees: 3, lines: 12, linesPerSession: 2 }, '2026-10');
    for (let i = 0; i < 3; i += 1) {
      seeded.employees.push({
        id: fakeUuid(seeded), primary_branch_id: BRANCH, name_en: trial.trialEmployeeName(i, runId),
        role_code: 'staff', hire_date: '2026-10-01',
      });
    }
    seeded.pricedRefs.push('line:R1');
    const resumed = await startFakeApi(seeded);
    try {
      assert.equal((await runTrial([...stagedArgs, '--resume'])).exitCode, 0);
      assertNeverApproves(resumed.state, 'resumed');
    } finally { await resumed.stop(); }
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
  const at = new Date(GENERATED_AT);
  assert.equal(trial.resolvePeriod('Asia/Kuwait', undefined, at), trial.previousPeriod('Asia/Kuwait', at).previous);
  assert.equal(trial.previousPeriod('Asia/Kuwait', at).previous, '2026-10');
  assert.equal(trial.daysInPeriod('2026-10'), 31);
  assert.equal(trial.shiftPeriod('2026-01', -1), '2025-12');
  assert.equal(trial.sourceRefs({ employees: [{ sources: [{ source_ref: 'line:L1' }], sales: [], corrections: [], tips: { card: '0.000', cash: '0.000' } }] }).has('line:L1'), true);
  assert.equal(trial.ownedSources({ employees: [{ name_en: 'Other', employee_id: 'x', sources: [{ source_ref: 'r' }], sales: [], corrections: [], tips: { card: '0.000', cash: '0.000' } }] }).length, 1);
  assert.equal(trial.localMinutesOfDay('Asia/Kuwait', at) >= 0 && trial.localMinutesOfDay('Asia/Kuwait', at) < 1440, true);
  assert.equal(trial.localMinutesOfDay('Asia/Kuwait', at), 13 * 60, 'the business timezone decides the minute of the day');
});
