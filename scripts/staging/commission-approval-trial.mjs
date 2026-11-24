#!/usr/bin/env node
// commission-approval-trial — spec 059 / slice 53-2 measurement (owner answer 2026-11-24: «سكربت تجربة عبر الـ API»).
// Prepares ONE dedicated staging TEST company with a large commission history through the PUBLIC HTTP API only,
// then generates and reviews the statement, so the operator can measure ONE real «approve commission statement»
// request by hand (docs/runbook.md activation gate; enabled only if that approval is < 200 ms). It never enables
// the approval switch, never issues a coverage proof and never approves.
// Pure HTTP client: no database access, no imports beyond node:* (global fetch). No secrets in code — credentials
// come from TRIAL_EMAIL / TRIAL_PASSWORD at run time and are never printed; output carries only counts, ids and
// timings. Every write is idempotent — Idempotency-Key from a deterministic run id plus an index (keyed routes
// replay), read-before-write for un-keyed routes — so a re-run after a crash completes what is missing and creates
// nothing twice. It refuses anything but the staging API host.

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const STAGING_API_HOST = 'api.staging.pospay.systems'; // docs/adr/0001 §6 + deploy/docker-compose.staging-shared.yml
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = '0.000';
const CUSTOMER_POOL = 20;
const SERVICE_COUNT = 10;
const TEST_CALLING_CODE = '965'; // synthetic test range (0000000x), documented in docs/runbook.md — never a real subscriber number

const usage = `usage: node scripts/staging/commission-approval-trial.mjs --api-url https://api.staging.pospay.systems \\
  --company <uuid> --business <uuid> --confirm-staging [--branch <uuid>] [--period YYYY-MM] [--employees 10] [--lines 2000] [--lines-per-session 2] \\
  [--delay-ms 200] [--wait-timeout 600] [--poll-ms 2000] [--dry-run]  |  env: TRIAL_EMAIL / TRIAL_PASSWORD (never printed)`;

function refuse(message) { console.error('refused: %s', message); process.exit(2); }

/** One line per failure: method, route pattern, HTTP status and the API error code — never a body or header. */
function fail(method, pattern, status, code) { console.error('ERROR %s %s status=%s code=%s', method, pattern, status, code); process.exit(1); }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCli(argv) {
  const { values } = parseArgs({
    argv, strict: true,
    options: {
      'api-url': { type: 'string' }, company: { type: 'string' }, business: { type: 'string' }, branch: { type: 'string' }, period: { type: 'string' },
      employees: { type: 'string', default: '10' }, lines: { type: 'string', default: '2000' }, 'lines-per-session': { type: 'string', default: '2' },
      'delay-ms': { type: 'string', default: '200' }, 'wait-timeout': { type: 'string', default: '600' }, 'poll-ms': { type: 'string', default: '2000' },
      'confirm-staging': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    },
  });
  const opts = {
    apiUrl: values['api-url'], company: values.company, business: values.business, branch: values.branch, period: values.period,
    employees: Number(values.employees), lines: Number(values.lines), linesPerSession: Number(values['lines-per-session']),
    delayMs: Number(values['delay-ms']), waitTimeoutS: Number(values['wait-timeout']), pollMs: Number(values['poll-ms']),
    confirmStaging: values['confirm-staging'], dryRun: values['dry-run'],
  };
  const int = (name, value, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max) refuse(`--${name} must be an integer in [${min}, ${max}]`);
  };
  int('employees', opts.employees, 1, 500);
  int('lines', opts.lines, 1, 500000);
  int('lines-per-session', opts.linesPerSession, 1, 20);
  int('delay-ms', opts.delayMs, 0, 60000);
  int('wait-timeout', opts.waitTimeoutS, 1, 86400);
  int('poll-ms', opts.pollMs, 10, 60000);
  return opts;
}

/** Guard, before any request: staging host exactly, explicit confirm, and an explicit company UUID. */
function guard(opts) {
  if (opts.apiUrl === undefined || opts.company === undefined || opts.business === undefined) refuse(usage);
  let host;
  try { host = new URL(opts.apiUrl).host; } catch { refuse(`--api-url is not a valid URL: ${opts.apiUrl}`); }
  if (host !== STAGING_API_HOST) refuse(`--api-url host must be exactly https://${STAGING_API_HOST} (docs/adr/0001 §6); got ${host}`);
  if (!opts.confirmStaging) refuse('--confirm-staging is required: this script writes test data to staging');
  if (!UUID.test(opts.company)) refuse('--company must be an explicit company UUID');
  if (!UUID.test(opts.business)) refuse('--business must be an explicit business UUID');
  if (opts.branch !== undefined && !UUID.test(opts.branch)) refuse('--branch must be a branch UUID');
  if (opts.period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(opts.period)) refuse('--period must be YYYY-MM');
}

function makeClient(baseUrl, company) {
  let cookie = '';
  let sent = 0;
  async function request(method, path, { body, idem, pattern } = {}, attempt = 0) {
    sent += 1;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(cookie === '' ? {} : { cookie }), 'x-company-id': company, ...(idem === undefined ? {} : { 'idempotency-key': idem }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length > 0) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    if (res.status >= 500 || res.status === 429) {
      if (attempt < 4) { await sleep(1000 * 2 ** attempt); return request(method, path, { body, idem, pattern }, attempt + 1); }
    }
    const json = await res.json().catch(() => null);
    if (res.status >= 400) fail(method, pattern ?? path, res.status, json?.code ?? `HTTP_${res.status}`);
    return json;
  }
  return { request, sentCount: () => sent };
}

/** Wall clock of `at` in `tz`, read back as an epoch under UTC, for offset arithmetic. */
function localWall(at, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const g = (type) => parts.find((p) => p.type === type)?.value;
  return Date.parse(`${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}Z`);
}

/** Local YYYY-MM-DD of an instant in `tz` (en-CA gives ISO-like dates). */
function localDateIn(tz, at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** ISO instant of local noon of `dateStr` in `tz`, with an explicit offset — the backdated occurred_at. */
function zonedNoonIso(dateStr, tz) {
  const noonUtc = Date.parse(`${dateStr}T12:00:00Z`);
  let at = noonUtc;
  for (let i = 0; i < 2; i += 1) at += noonUtc - localWall(at, tz);
  const minutes = Math.round((noonUtc - at) / 60000);
  const offset = minutes === 0 ? 'Z' : `${minutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
  return `${dateStr}T12:00:00.000${offset}`;
}

const periodOf = (date) => date.slice(0, 7);
const periodDay = (period, n) => `${period}-${String(n).padStart(2, '0')}`;

function shiftPeriod(period, delta) {
  const [y, m] = period.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const daysInPeriod = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** The previous calendar month in the branch's own timezone; the only period a backdated run can target. */
function previousPeriod(tz) {
  const current = periodOf(localDateIn(tz));
  return { current, previous: shiftPeriod(current, -1) };
}

/** The trial period: default = previous month in the branch timezone; only that month is allowed. */
function resolvePeriod(tz, wanted) {
  const { current, previous } = previousPeriod(tz);
  const period = wanted ?? previous;
  if (period >= current) refuse(`period ${period} has not ended yet; the statement needs an ended month`);
  if (period < previous) refuse(`period ${period} is too old: backdated service sessions are accepted only from the 1st of ${previous} (SESSION_TIME_TOO_OLD)`);
  return period;
}
async function signIn(client) {
  const email = process.env.TRIAL_EMAIL, password = process.env.TRIAL_PASSWORD;
  if (email === undefined || email === '' || password === undefined || password === '') refuse('TRIAL_EMAIL and TRIAL_PASSWORD must be set (a user of the TEST company; values are never printed)');
  return client.request('POST', '/v1/auth/sign-in/email', { body: { email, password } });
}

function findCompanyAndBranch(workspaces, opts) {
  const company = workspaces.companies.find((c) => c.id === opts.company.toLowerCase());
  if (company === undefined) refuse(`the signed-in user has no membership in company ${opts.company}`);
  const business = company.businesses.find((b) => b.id === opts.business.toLowerCase());
  if (business === undefined) refuse(`business ${opts.business} is not part of company ${opts.company}`);
  const active = business.branches.filter((b) => b.is_active);
  if (opts.branch !== undefined) {
    const branch = active.find((b) => b.id === opts.branch.toLowerCase());
    if (branch === undefined) refuse(`branch ${opts.branch} is not an active branch of business ${opts.business}`);
    return { business, branch };
  }
  const ids = active.map((b) => b.id).join(', ');
  if (active.length !== 1) refuse(`expected exactly one active branch on business ${opts.business}, found ${active.length}: ${ids} — pass --branch`);
  return { business, branch: active[0] };
}

async function getEstimate(client, businessId, period) {
  return client.request('GET', `/v1/businesses/${businessId}/commissions/periods/${period}/estimate`);
}

/** Every priced source in the period; the trial refuses to run into existing history it did not create. */
function countSources(estimate) {
  let count = 0;
  for (const employee of estimate.employees) {
    count += employee.sources.length + employee.sales.length + employee.corrections.length;
    if (employee.tips.card !== ZERO || employee.tips.cash !== ZERO) count += 1;
  }
  return count;
}

async function preflight(client, opts) {
  const workspaces = await client.request('GET', '/v1/me/workspaces');
  const { business, branch } = findCompanyAndBranch(workspaces, opts);
  const timezone = branch.effective_timezone;
  const period = resolvePeriod(timezone, opts.period);
  const branchPath = `/v1/businesses/${business.id}/branches/${branch.id}/service-sessions`;
  await client.request('GET', `${branchPath}/capabilities`, { pattern: '/v1/businesses/:businessId/branches/:branchId/service-sessions/capabilities' });
  const context = await client.request('GET', `${branchPath}/recording-context`, { pattern: '/v1/businesses/:businessId/branches/:branchId/service-sessions/recording-context' });
  if (context.recorder_membership_ids.length !== 1) {
    refuse(`the trial user must have exactly one recorder membership on the branch, found ${context.recorder_membership_ids.length}`);
  }
  const statement = await client.request('GET', `/v1/businesses/${business.id}/commission-statements/${period}`, { pattern: '/v1/businesses/:businessId/commission-statements/:period' });
  if (statement.status !== 'DRAFT') refuse(`statement ${period} is ${statement.status}; the trial needs a month that was never generated or reviewed`);
  const estimate = await getEstimate(client, business.id, period);
  const sources = countSources(estimate);
  if (sources !== 0) refuse(`period ${period} already carries ${sources} commission source(s) the trial did not create; use a clean period or company`);
  await client.request('GET', `/v1/businesses/${business.id}/services?limit=1`, { pattern: '/v1/businesses/:businessId/services' });
  return { branchId: branch.id, businessId: business.id, timezone, period, recorderMembershipId: context.recorder_membership_ids[0] };
}

async function pageThrough(client, basePath, pattern) {
  const items = [];
  let cursor;
  for (;;) {
    const page = await client.request('GET', `${basePath}?limit=100${cursor === undefined ? '' : `&cursor=${cursor}`}`, { pattern });
    items.push(...page.items);
    if (page.next_cursor === null) return items;
    cursor = page.next_cursor;
  }
}

const trialNamed = (items, prefix) => new Map(items.filter((item) => item.name_en.startsWith(prefix)).map((item) => [item.name_en, item]));

async function ensureServices(client, businessId) {
  const byName = trialNamed(await pageThrough(client, `/v1/businesses/${businessId}/services`, '/v1/businesses/:businessId/services'), 'Trial Service ');
  const services = [];
  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    const name = `Trial Service ${String(i + 1).padStart(2, '0')}`;
    let service = byName.get(name);
    if (service === undefined) {
      service = await client.request('POST', `/v1/businesses/${businessId}/services`, {
        pattern: '/v1/businesses/:businessId/services',
        body: { name_en: name, name_ar: null, price: `${((i % 5) + 1) * 5}.000`, commission_rule: { kind: 'FOLLOW_PLAN' }, counts_toward_threshold: true, duration_minutes: 30 },
      });
    }
    services.push(service);
  }
  return services;
}

async function ensureCustomers(client, businessId) {
  const customers = [];
  for (let i = 0; i < CUSTOMER_POOL; i += 1) {
    customers.push(await client.request('POST', `/v1/businesses/${businessId}/customers/find-or-create`, {
      pattern: '/v1/businesses/:businessId/customers/find-or-create',
      body: { phone: { calling_code: TEST_CALLING_CODE, national_number: `0000000${i + 1}` }, name: `Trial Customer ${String(i + 1).padStart(2, '0')}`, locale: 'en', gender: i % 2 === 0 ? 'female' : 'male' },
    }));
  }
  return customers;
}

async function ensureEmployees(client, opts, period) {
  const byName = trialNamed(await pageThrough(client, `/v1/businesses/${opts.businessId}/employees`, '/v1/businesses/:businessId/employees'), 'Trial Employee ');
  const hireDate = periodDay(period, 1);
  const employees = [];
  for (let i = 0; i < opts.employees; i += 1) {
    const name = `Trial Employee ${String(i + 1).padStart(3, '0')}`;
    let employee = byName.get(name);
    if (employee === undefined) {
      employee = await client.request('POST', `/v1/businesses/${opts.businessId}/employees`, {
        pattern: '/v1/businesses/:businessId/employees',
        body: { primary_branch_id: opts.branchId, name_en: name, name_ar: null, role_code: 'staff', hire_date: hireDate },
      });
    } else if (employee.primary_branch_id !== opts.branchId) refuse(`employee ${employee.id} carries the trial name but another branch; clean it up or choose another branch`);
    employees.push(employee);
  }
  return employees;
}

async function ensureSalariesAndPlans(client, ctx, runId, period) {
  for (let i = 0; i < ctx.employeeIds.length; i += 1) {
    const employeeId = ctx.employeeIds[i];
    await client.request('POST', `/v1/businesses/${ctx.businessId}/employees/${employeeId}/salaries`, {
      pattern: '/v1/businesses/:businessId/employees/:employeeId/salaries', idem: `trial-${runId}-salary-${i}`,
      body: { effective_from: periodDay(period, 1), amount: '500.000', reason: 'commission-approval-trial staging measurement' },
    });
    await client.request('POST', `/v1/businesses/${ctx.businessId}/employees/${employeeId}/commission-plan-versions`, {
      pattern: '/v1/businesses/:businessId/employees/:employeeId/commission-plan-versions', idem: `trial-${runId}-plan-${i}`,
      body: { effective_from: periodDay(period, 1), whole_period: true, base: { enabled: true, calc: { kind: 'PCT', bps: 500 } }, tiers: { enabled: false }, package_sale: { enabled: false } },
    });
  }
}

/** Deterministic session body for request i; identical bodies across runs keep idempotent replays valid. */
function sessionBody(index, ctx) {
  const occurredAt = zonedNoonIso(periodDay(ctx.period, (index % ctx.days) + 1), ctx.timezone);
  const lines = [];
  for (let j = 0; j < ctx.linesPerSession && index * ctx.linesPerSession + j < ctx.lines; j += 1) {
    const k = index * ctx.linesPerSession + j;
    lines.push({
      service_id: ctx.services[k % ctx.services.length].id, price: ctx.services[k % ctx.services.length].price,
      discount: { kind: 'AMOUNT', amount: ZERO }, performers: [{ employee_id: ctx.employees[k % ctx.employees.length].id }],
    });
  }
  return { customer_id: ctx.customers[index % ctx.customers.length].id, recorder_membership_id: ctx.recorderMembershipId, occurred_at: occurredAt, lines };
}

async function recordSessions(client, ctx, runId, delayMs) {
  const sessionCount = Math.ceil(ctx.lines / ctx.linesPerSession);
  let accepted = 0;
  for (let i = 0; i < sessionCount; i += 1) {
    const response = await client.request('POST', `/v1/businesses/${ctx.businessId}/branches/${ctx.branchId}/service-sessions`, {
      pattern: '/v1/businesses/:businessId/branches/:branchId/service-sessions', idem: `trial-${runId}-session-${i}`, body: sessionBody(i, ctx),
    });
    accepted += response.session.lines.length;
    if (response.rejected_lines.length > 0) console.error('session %d: %d rejected line(s)', i, response.rejected_lines.length);
    if (delayMs > 0 && i + 1 < sessionCount) await sleep(delayMs);
  }
  return { sessionCount, accepted };
}

async function waitConvergence(client, ctx, expected, pollMs, waitTimeoutS) {
  const deadline = Date.now() + waitTimeoutS * 1000;
  let previous = -1;
  for (;;) {
    const estimate = await getEstimate(client, ctx.businessId, ctx.period);
    const count = countSources(estimate);
    if (count === expected && previous === expected) return estimate;
    previous = count;
    if (Date.now() + pollMs > deadline) {
      console.error('timeout: the estimate for %s shows %d of %d consumed source(s) after %ds', ctx.period, count, expected, waitTimeoutS);
      console.error('the worker has not consumed every commission event; fix the worker or raise --wait-timeout, then re-run the same command');
      process.exit(1);
    }
    await sleep(pollMs);
  }
}

async function generateAndReview(client, ctx, runId) {
  const view = await client.request('POST', `/v1/businesses/${ctx.businessId}/commission-statements/${ctx.period}/generate`, {
    pattern: '/v1/businesses/:businessId/commission-statements/:period/generate', idem: `trial-${runId}-generate`,
  });
  if (view.reader_scope !== 'BUSINESS') refuse(`the trial user must read commissions business-wide, got scope ${view.reader_scope}`);
  return client.request('POST', `/v1/businesses/${ctx.businessId}/commission-statements/${ctx.period}/review`, {
    pattern: '/v1/businesses/:businessId/commission-statements/:period/review', idem: `trial-${runId}-review`,
    body: { expected_fingerprint: view.current_fingerprint, expected_statement_fingerprint: view.current_statement_fingerprint },
  });
}

function printSummary(opts, ctx, times, counts, sent, estimate, review) {
  console.log('--- commission-approval-trial summary ---');
  console.log(`company ${opts.company} business ${ctx.businessId} branch ${ctx.branchId} period ${ctx.period}`);
  console.log(`employees ${counts.employees} services ${counts.services} customers ${counts.customers} sessions ${counts.sessions} lines ${counts.accepted}/${opts.lines}`);
  console.log(`setup ${times.setupMs}ms record ${times.recordMs}ms wait ${times.waitMs}ms generate+review ${times.writeMs}ms total ${times.totalMs}ms; HTTP requests ${sent}`);
  console.log(`estimate total ${estimate.total} review status ${review.status}`);
  console.log(`next manual steps (docs/runbook.md, commission-approval activation): enable the switch
(pnpm platform:commission-approval --company <uuid> --enable ...), issue the coverage proof
(pnpm platform:commission-coverage --company <uuid> --businesses <uuid> --from <first-day> --to <last-day> ...),
approve the REVIEWED statement from the admin ONCE and read http.ms for the route
/v1/businesses/:businessId/commission-statements/:period/approve in the api logs ("request completed");
the real company is enabled only if that measured approval is under 200 ms.`);
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  guard(opts);
  const client = makeClient(new URL(opts.apiUrl).origin, opts.company.toLowerCase());
  await signIn(client);
  const ctx = await preflight(client, opts);
  console.log(`preflight ok: branch ${ctx.branchId} tz ${ctx.timezone} period ${ctx.period} statement DRAFT`);
  if (opts.dryRun) { console.log('dry-run: stopping before any write'); return; }
  const started = Date.now();
  const runId = createHash('sha256').update(`${opts.company}|${opts.business}|${ctx.period}|${opts.employees}|${opts.lines}`).digest('hex').slice(0, 8);
  const services = await ensureServices(client, ctx.businessId);
  const customers = await ensureCustomers(client, ctx.businessId);
  const employees = await ensureEmployees(client, { businessId: ctx.businessId, branchId: ctx.branchId, employees: opts.employees }, ctx.period);
  await ensureSalariesAndPlans(client, { businessId: ctx.businessId, employeeIds: employees.map((e) => e.id) }, runId, ctx.period);
  const setupMs = Date.now() - started;
  const recordStarted = Date.now();
  const sessionCtx = { businessId: ctx.businessId, branchId: ctx.branchId, period: ctx.period, timezone: ctx.timezone, recorderMembershipId: ctx.recorderMembershipId, services, customers, employees, lines: opts.lines, linesPerSession: opts.linesPerSession, days: daysInPeriod(ctx.period) };
  const recording = await recordSessions(client, sessionCtx, runId, opts.delayMs);
  const recordMs = Date.now() - recordStarted;
  const waitStarted = Date.now();
  const estimate = await waitConvergence(client, { businessId: ctx.businessId, period: ctx.period }, recording.accepted, opts.pollMs, opts.waitTimeoutS);
  const waitMs = Date.now() - waitStarted;
  const writeStarted = Date.now();
  const review = await generateAndReview(client, { businessId: ctx.businessId, period: ctx.period }, runId);
  const writeMs = Date.now() - writeStarted;
  printSummary(opts, ctx, { setupMs, recordMs, waitMs, writeMs, totalMs: Date.now() - started }, { employees: employees.length, services: services.length, customers: customers.length, sessions: recording.sessionCount, accepted: recording.accepted }, client.sentCount(), estimate, review);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('unexpected failure: %s %s', error?.name ?? 'Error', error?.message ?? String(error));
    process.exit(1);
  });
}

export { countSources, daysInPeriod, guard, localDateIn, main, previousPeriod, resolvePeriod, sessionBody, shiftPeriod, zonedNoonIso };
