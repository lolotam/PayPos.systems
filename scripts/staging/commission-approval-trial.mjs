#!/usr/bin/env node
// commission-approval-trial — spec 059 / slice 53-2 measurement (owner answer 2026-11-24: «سكربت تجربة عبر الـ API»).
// Prepares ONE dedicated staging TEST company with a large commission history through the PUBLIC HTTP API only,
// then generates and reviews the statement, so the operator can measure ONE real «approve commission statement»
// request by hand (docs/runbook.md activation gate; enabled only if that approval is < 200 ms). It never enables
// the approval switch, never issues a coverage proof and never approves. Pure HTTP client: no database access,
// no imports beyond node:* (global fetch). No secrets in code — credentials come from TRIAL_EMAIL /
// TRIAL_PASSWORD at run time and are never printed; output carries only counts, ids and timings. Every write is
// idempotent — every keyed route sends an Idempotency-Key built from the run id (the period plus the options that
// shape the run) and the hash of its exact body, so a re-run replays and a changed body can never replay an old
// key; un-keyed routes are read-before-write idempotent — so a re-run after a crash completes what is missing and
// creates nothing twice. It refuses anything but the exact staging API origin.

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const STAGING_ORIGIN = 'https://api.staging.pospay.systems'; // docs/adr/0001 §6 + deploy/docker-compose.staging-shared.yml
const STAGING_HOST = 'api.staging.pospay.systems';
const TRIAL_PREFIX = 'TRIAL-';
const TRIAL_EMPLOYEE_PREFIX = 'Trial Employee ';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const ZERO = '0.000';
const CUSTOMER_POOL = 20;
const SERVICE_COUNT = 10;
const CUSTOMER_CALLING_CODE = '1';
const CUSTOMER_FIRST_NATIONAL = 2025550100; // NANP fictional block 202-555-0100..0119; see docs/runbook.md

const usage = `usage: node scripts/staging/commission-approval-trial.mjs --api-url https://api.staging.pospay.systems \\
  --company <uuid> --business <uuid> --confirm-staging --notifications-off-confirmed [--branch <uuid>] [--period YYYY-MM] [--employees 10] [--lines 2000] \\
  [--lines-per-session 2] [--delay-ms 200] [--wait-timeout 600] [--poll-ms 2000] [--retry-backoff-ms 1000] [--resume] [--dry-run]
env: TRIAL_EMAIL / TRIAL_PASSWORD (never printed)`;

/** A failure the script reports itself: the exit code and the one line the operator may read. */
class TrialError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = 'TrialError';
    this.exitCode = exitCode;
  }
}

/** A failed API call: method, route pattern, HTTP status and the API code — never a body or a header. */
class ApiFailure extends TrialError {
  constructor(method, pattern, status, code) {
    super(1, 'api failure');
    Object.assign(this, { method, pattern, status, code });
  }
}

/** The operator asked for something the script refuses to do; the run stops with exit code 2. */
function refuse(message) {
  throw new TrialError(2, `refused: ${message}`);
}

/** One line per failure: method, route pattern, HTTP status and the API error code — never a body or header. */
function printApiFailure(failure) {
  console.error('ERROR %s %s status=%s code=%s', failure.method, failure.pattern, failure.status,
    API_CODE.test(failure.code) ? failure.code : 'UNKNOWN');
}

/**
 * The one place a failure becomes an exit code. A known failure prints its own line; an unexpected one prints
 * a fixed line and its class name — never its message, which could carry a response body.
 */
function reportFailure(error) {
  if (error instanceof ApiFailure) { printApiFailure(error); return error.exitCode; }
  if (error instanceof TrialError) { console.error('%s', error.message); return error.exitCode; }
  console.error('unexpected failure: %s', error?.name ?? 'Error');
  return 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashOf = (parts) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);

function parseCli(argv) {
  const { values } = parseArgs({
    argv, strict: true,
    options: {
      'api-url': { type: 'string' }, company: { type: 'string' }, business: { type: 'string' }, branch: { type: 'string' }, period: { type: 'string' },
      employees: { type: 'string', default: '10' }, lines: { type: 'string', default: '2000' }, 'lines-per-session': { type: 'string', default: '2' },
      'delay-ms': { type: 'string', default: '200' }, 'wait-timeout': { type: 'string', default: '600' }, 'poll-ms': { type: 'string', default: '2000' },
      'retry-backoff-ms': { type: 'string', default: '1000' },
      'confirm-staging': { type: 'boolean', default: false }, resume: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
      'notifications-off-confirmed': { type: 'boolean', default: false },
    },
  });
  const opts = {
    apiUrl: values['api-url'], company: values.company, business: values.business, branch: values.branch, period: values.period,
    employees: Number(values.employees), lines: Number(values.lines), linesPerSession: Number(values['lines-per-session']),
    delayMs: Number(values['delay-ms']), waitTimeoutS: Number(values['wait-timeout']), pollMs: Number(values['poll-ms']),
    retryBackoffMs: Number(values['retry-backoff-ms']), confirmStaging: values['confirm-staging'], resume: values.resume, dryRun: values['dry-run'],
    notificationsOffConfirmed: values['notifications-off-confirmed'],
  };
  const bounds = { employees: [1, 500], lines: [1, 500000], 'lines-per-session': [1, 20], 'delay-ms': [0, 60000], 'wait-timeout': [1, 86400], 'poll-ms': [10, 60000], 'retry-backoff-ms': [1, 60000] };
  for (const [name, [min, max]] of Object.entries(bounds)) {
    const value = Number(values[name]);
    if (!Number.isInteger(value) || value < min || value > max) refuse(`--${name} must be an integer in [${min}, ${max}]`);
  }
  return opts;
}

/** Guard, before any request: exact https staging origin only, explicit confirm, and explicit UUIDs. */
function guard(opts) {
  if (opts.apiUrl === undefined || opts.company === undefined || opts.business === undefined) refuse(usage);
  let url;
  try { url = new URL(opts.apiUrl); } catch { refuse(`--api-url is not a valid URL: ${opts.apiUrl}`); }
  if (/[A-Z]/.test(opts.apiUrl)) refuse('--api-url must use the exact lower-case staging origin');
  if (url.protocol !== 'https:') refuse(`--api-url must be https (credentials over http are refused); got ${url.protocol}`);
  if (url.username !== '' || url.password !== '') refuse('--api-url must not carry userinfo');
  const authority = opts.apiUrl.slice(opts.apiUrl.indexOf('://') + 3).split(/[/?#]/)[0];
  if (authority.includes(':')) refuse('--api-url must use the default port; an explicit port is refused');
  if (url.hostname !== STAGING_HOST || url.hostname.endsWith('.')) refuse(`--api-url host must be exactly ${STAGING_HOST}; got ${url.hostname}`);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') refuse('--api-url must be the bare origin: no path, query or fragment');
  if (!opts.confirmStaging) refuse('--confirm-staging is required: this script writes test data to staging');
  if (!opts.notificationsOffConfirmed) refuse('--notifications-off-confirmed is required: switch customer rating and notification messages OFF for the test business first, then re-run with the flag');
  if (!UUID.test(opts.company)) refuse('--company must be an explicit company UUID');
  if (!UUID.test(opts.business)) refuse('--business must be an explicit business UUID');
  if (opts.branch !== undefined && !UUID.test(opts.branch)) refuse('--branch must be a branch UUID');
  if (opts.period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(opts.period)) refuse('--period must be YYYY-MM');
}

/**
 * The HTTP client. Every URL is built from the constant origin, never from an argument, and every request
 * refuses to follow a redirect — a 307 from sign-in must never resend the body somewhere else. A keyed route
 * may be retried (the same key replays); an un-keyed one may not (the caller lists again instead).
 */
function makeClient(origin, company, backoffMs) {
  let cookie = '';
  let sent = 0;
  async function request(method, path, { body, idem, pattern } = {}, attempt = 0) {
    sent += 1;
    const retryable = idem !== undefined || method === 'GET';
    let res;
    try {
      res = await fetch(`${origin}${path}`, {
        method, redirect: 'error',
        headers: {
          ...(cookie === '' ? {} : { cookie }), 'x-company-id': company, ...(idem === undefined ? {} : { 'idempotency-key': idem }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      if (retryable && attempt < 4) { await sleep(backoffMs * 2 ** attempt); return request(method, path, { body, idem, pattern }, attempt + 1); }
      throw new ApiFailure(method, pattern ?? path, 0, 'NETWORK_ERROR');
    }
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length > 0) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    if ((res.status >= 500 || res.status === 429) && retryable && attempt < 4) {
      await sleep(backoffMs * 2 ** attempt);
      return request(method, path, { body, idem, pattern }, attempt + 1);
    }
    const json = await res.json().catch(() => null);
    if (res.status >= 400) throw new ApiFailure(method, pattern ?? path, res.status, json?.code ?? `HTTP_${res.status}`);
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
function localDateIn(tz, at) {
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

/** The previous calendar month in the business timezone; the only period a backdated run can target. */
function previousPeriod(tz, at) {
  const current = periodOf(localDateIn(tz, at));
  return { current, previous: shiftPeriod(current, -1) };
}

/** The trial period: default = previous month in the business timezone; only that month is allowed. */
function resolvePeriod(tz, wanted, at) {
  const { current, previous } = previousPeriod(tz, at);
  const period = wanted ?? previous;
  if (period >= current) refuse(`period ${period} has not ended yet; the statement needs an ended month`);
  if (period < previous) refuse(`period ${period} is too old: backdated service sessions are accepted only from the 1st of ${previous} (SESSION_TIME_TOO_OLD)`);
  return period;
}

/** Minutes past local midnight of `at` in `tz`. */
function localMinutesOfDay(tz, at) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  return g('hour') * 60 + g('minute');
}

/** Refuse to start within 10 minutes of midnight in the business timezone: the measured month flips there. */
function assertPeriodStable(tz, at) {
  const minutes = localMinutesOfDay(tz, at);
  if (minutes < 10 || minutes >= 1440 - 10) {
    const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    refuse(`"now" in the business timezone (${tz}) is ${clock} — within 10 minutes of midnight; wait 10 minutes so the previous-month answer cannot flip mid-run`);
  }
}

/**
 * The identity of one trial run: the measured period plus the options that shape it. It is part of every
 * idempotency key, so different options can never replay a key that was minted for another body, and it is
 * written into every trial employee name, so a resume can prove that the history it finds is its own.
 */
function runIdOf(opts, period) {
  return hashOf([period, String(opts.employees), String(opts.lines), String(opts.linesPerSession)]);
}

/** The deterministic name of the i-th trial employee of this run. */
function trialEmployeeName(index, runId) {
  return `${TRIAL_EMPLOYEE_PREFIX}${String(index + 1).padStart(3, '0')} (${runId})`;
}

/** Every employee name this run creates — the preflight accepts only sources of these employees. */
function trialEmployeeNames(count, runId) {
  return new Set(Array.from({ length: count }, (_, index) => trialEmployeeName(index, runId)));
}

async function signIn(client) {
  const email = process.env.TRIAL_EMAIL, password = process.env.TRIAL_PASSWORD;
  if (email === undefined || email === '' || password === undefined || password === '') refuse('TRIAL_EMAIL and TRIAL_PASSWORD must be set (a user of the TEST company; values are never printed)');
  return client.request('POST', '/v1/auth/sign-in/email', { body: { email, password } });
}

function findCompanyAndBranch(workspaces, opts) {
  const company = workspaces.companies.find((c) => c.id === opts.company.toLowerCase());
  if (company === undefined) refuse(`the signed-in user has no membership in company ${opts.company}`);
  if (!company.name_en.startsWith(TRIAL_PREFIX)) refuse(`company ${opts.company} is not a dedicated test company: its English name must start with ${TRIAL_PREFIX} (got "${company.name_en}"); create or rename the dedicated test company`);
  const business = company.businesses.find((b) => b.id === opts.business.toLowerCase());
  if (business === undefined) refuse(`business ${opts.business} is not part of company ${opts.company}`);
  if (!business.name_en.startsWith(TRIAL_PREFIX)) refuse(`business ${opts.business} is not a dedicated test business: its English name must start with ${TRIAL_PREFIX} (got "${business.name_en}"); create or rename the dedicated test business`);
  const active = business.branches.filter((b) => b.is_active);
  if (opts.branch !== undefined) {
    const branch = active.find((b) => b.id === opts.branch.toLowerCase());
    if (branch === undefined) refuse(`branch ${opts.branch} is not an active branch of business ${opts.business}`);
    return { business, branch };
  }
  if (active.length !== 1) refuse(`expected exactly one active branch on business ${opts.business}, found ${active.length}: ${active.map((b) => b.id).join(', ')} — pass --branch`);
  return { business, branch: active[0] };
}

/** Every priced source ref in the period (line:<lineId> for COMMISSION rows). */
function sourceRefs(estimate) {
  const refs = new Set();
  for (const employee of estimate.employees) for (const source of employee.sources) refs.add(source.source_ref);
  return refs;
}

/** Every priced source of any kind in the period, with the employees that own them. */
function ownedSources(estimate) {
  const owned = [];
  for (const employee of estimate.employees) {
    const count = employee.sources.length + employee.sales.length + employee.corrections.length
      + ((employee.tips.card !== ZERO || employee.tips.cash !== ZERO) ? 1 : 0);
    if (count > 0) owned.push({ employee, count });
  }
  return owned;
}

async function preflight(client, opts) {
  const workspaces = await client.request('GET', '/v1/me/workspaces');
  const { business, branch } = findCompanyAndBranch(workspaces, opts);
  const branchPath = `/v1/businesses/${business.id}/branches/${branch.id}/service-sessions`;
  await client.request('GET', `${branchPath}/capabilities`, { pattern: '/v1/businesses/:businessId/branches/:branchId/service-sessions/capabilities' });
  const context = await client.request('GET', `${branchPath}/recording-context`, { pattern: '/v1/businesses/:businessId/branches/:branchId/service-sessions/recording-context' });
  if (context.recorder_membership_ids.length !== 1) refuse(`the trial user must have exactly one recorder membership on the branch, found ${context.recorder_membership_ids.length}`);
  const timezone = context.business_timezone;
  // The API's own clock decides the backdating window, so the trial reads the period from the same clock.
  const at = new Date(context.generated_at);
  assertPeriodStable(timezone, at);
  const period = resolvePeriod(timezone, opts.period, at);
  const runId = runIdOf(opts, period);
  const businesses = await pageThrough(client, '/v1/businesses', '/v1/businesses');
  const record = businesses.find((item) => item.id === business.id);
  if (record === undefined) refuse(`business ${business.id} is not visible through the businesses read`);
  const createdMonth = periodOf(localDateIn(timezone, new Date(record.created_at)));
  if (period < createdMonth) refuse(`the business was created in ${createdMonth}, after the target month ${period} (COMMISSION_PERIOD_BEFORE_BUSINESS); the earliest month that can be measured is ${createdMonth} — but only while it is still the previous month at run time`);
  const rating = await client.request('GET', `/v1/businesses/${business.id}/rating-settings`, { pattern: '/v1/businesses/:businessId/rating-settings' });
  if (rating.requests_enabled !== false) refuse(`customer rating requests are enabled on this business; turn them off before the trial so recorded sessions never send outbound messages`);
  const statement = await client.request('GET', `/v1/businesses/${business.id}/commission-statements/${period}`, { pattern: '/v1/businesses/:businessId/commission-statements/:period' });
  if (statement.status !== 'DRAFT') refuse(`statement ${period} is ${statement.status}; the trial needs a month that was never generated or reviewed`);
  const estimate = await getEstimate(client, business.id, period);
  const owned = ownedSources(estimate);
  if (owned.length > 0 && !opts.resume) refuse(`${owned.reduce((sum, row) => sum + row.count, 0)} commission source(s) already exist in ${period}; re-run the same command with --resume to complete an interrupted trial, or target a clean period`);
  const mine = trialEmployeeNames(opts.employees, runId);
  const foreign = owned.filter((row) => !mine.has(row.employee.name_en));
  if (foreign.length > 0) {
    const otherRun = foreign.filter((row) => row.employee.name_en.startsWith(TRIAL_EMPLOYEE_PREFIX));
    if (otherRun.length > 0) refuse(`different options detected: the trial in ${period} was created with other options (period, --employees, --lines or --lines-per-session differ) — ${otherRun.map((row) => row.employee.name_en).join(', ')}; complete it with the original options or use a clean period`);
    refuse(`commission source(s) in ${period} belong to non-trial employee(s): ${foreign.map((row) => row.employee.employee_id).join(', ')}; use a clean period or company`);
  }
  return { branchId: branch.id, businessId: business.id, timezone, period, runId, recorderMembershipId: context.recorder_membership_ids[0], createdMonth };
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

/**
 * An un-keyed create with in-run recovery: the create is never retried blindly — after a failed or lost answer
 * the script lists again and creates only when the record is still missing, so nothing is written twice.
 */
async function createIfMissing(name, existing, list, create) {
  let known = existing;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found = known.get(name);
    if (found !== undefined) return found;
    try {
      return await create();
    } catch (error) {
      if (attempt === 1) throw error;
      known = await list();
    }
  }
}

async function ensureServices(client, businessId) {
  const pattern = '/v1/businesses/:businessId/services';
  const list = async () => trialNamed(await pageThrough(client, `/v1/businesses/${businessId}/services`, pattern), 'Trial Service ');
  const existing = await list();
  const services = [];
  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    const name = `Trial Service ${String(i + 1).padStart(2, '0')}`;
    services.push(await createIfMissing(name, existing, list, () => client.request('POST', `/v1/businesses/${businessId}/services`, {
      pattern,
      body: { name_en: name, name_ar: null, price: `${((i % 5) + 1) * 5}.000`, commission_rule: { kind: 'FOLLOW_PLAN' }, counts_toward_threshold: true, duration_minutes: 30 },
    })));
  }
  return services;
}

async function ensureCustomers(client, businessId) {
  const customers = [];
  for (let i = 0; i < CUSTOMER_POOL; i += 1) {
    customers.push(await client.request('POST', `/v1/businesses/${businessId}/customers/find-or-create`, {
      pattern: '/v1/businesses/:businessId/customers/find-or-create',
      body: {
        phone: { calling_code: CUSTOMER_CALLING_CODE, national_number: String(CUSTOMER_FIRST_NATIONAL + i) },
        name: `Trial Customer ${String(i + 1).padStart(2, '0')}`, locale: 'en', gender: i % 2 === 0 ? 'female' : 'male',
      },
    }));
  }
  return customers;
}

async function ensureEmployees(client, ctx) {
  const pattern = '/v1/businesses/:businessId/employees';
  const list = async () => new Map((await pageThrough(client, `/v1/businesses/${ctx.businessId}/employees`, pattern)).map((item) => [item.name_en, item]));
  const existing = await list();
  const hireDate = periodDay(ctx.period, 1);
  const employees = [];
  for (let i = 0; i < ctx.employees; i += 1) {
    const name = trialEmployeeName(i, ctx.runId);
    const employee = await createIfMissing(name, existing, list, () => client.request('POST', `/v1/businesses/${ctx.businessId}/employees`, {
      pattern,
      body: { primary_branch_id: ctx.branchId, name_en: name, name_ar: null, role_code: 'staff', hire_date: hireDate },
    }));
    if (employee.primary_branch_id !== ctx.branchId) refuse(`employee ${employee.id} carries the trial name but another branch; clean it up or choose another branch`);
    employees.push(employee);
  }
  return employees;
}

async function ensureSalariesAndPlans(client, ctx) {
  for (const employeeId of ctx.employeeIds) {
    const salaryBody = { effective_from: periodDay(ctx.period, 1), amount: '500.000', reason: 'commission-approval-trial staging measurement' };
    await client.request('POST', `/v1/businesses/${ctx.businessId}/employees/${employeeId}/salaries`, {
      pattern: '/v1/businesses/:businessId/employees/:employeeId/salaries', idem: `trial-salary-${ctx.runId}-${hashOf([employeeId, JSON.stringify(salaryBody)])}`, body: salaryBody,
    });
    const planBody = { effective_from: periodDay(ctx.period, 1), whole_period: true, base: { enabled: true, calc: { kind: 'PCT', bps: 500 } }, tiers: { enabled: false }, package_sale: { enabled: false } };
    await client.request('POST', `/v1/businesses/${ctx.businessId}/employees/${employeeId}/commission-plan-versions`, {
      pattern: '/v1/businesses/:businessId/employees/:employeeId/commission-plan-versions', idem: `trial-plan-${ctx.runId}-${hashOf([employeeId, JSON.stringify(planBody)])}`, body: planBody,
    });
  }
}

/** Deterministic session body for request i; identical bodies keep idempotent replays valid. */
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

async function recordSessions(client, ctx, delayMs) {
  const sessionCount = Math.ceil(ctx.lines / ctx.linesPerSession);
  const lineIds = [];
  for (let i = 0; i < sessionCount; i += 1) {
    const body = sessionBody(i, ctx);
    const idem = `trial-session-${ctx.runId}-${hashOf([ctx.businessId, ctx.branchId, String(i), JSON.stringify(body)])}`;
    const response = await client.request('POST', `/v1/businesses/${ctx.businessId}/branches/${ctx.branchId}/service-sessions`, {
      pattern: '/v1/businesses/:businessId/branches/:branchId/service-sessions', idem, body,
    });
    if (response.rejected_lines.length > 0) {
      throw new TrialError(1, `rejected lines in session ${i}: ${response.rejected_lines.map((line) => line.code).join(',')}`);
    }
    for (const line of response.session.lines) lineIds.push(line.id);
    if (delayMs > 0 && i + 1 < sessionCount) await sleep(delayMs);
  }
  if (lineIds.length === 0) throw new TrialError(1, 'no service line was recorded; the trial cannot measure an empty month');
  return { sessionCount, accepted: lineIds.length, lineIds };
}

/** Wait until every recorded line is priced in the estimate: the worker must consume every commission event. */
async function waitConvergence(client, ctx, lineIds, pollMs, waitTimeoutS) {
  const expected = new Set(lineIds.map((id) => `line:${id}`));
  if (expected.size === 0) throw new TrialError(1, 'no recorded line to wait for; the trial cannot measure an empty month');
  const deadline = Date.now() + waitTimeoutS * 1000;
  for (;;) {
    const estimate = await getEstimate(client, ctx.businessId, ctx.period);
    const present = sourceRefs(estimate);
    const missing = [...expected].filter((ref) => !present.has(ref));
    if (missing.length === 0) return estimate;
    if (Date.now() + pollMs > deadline) {
      throw new TrialError(1, `timeout: ${expected.size - missing.length} of ${expected.size} recorded line(s) are priced in the estimate for ${ctx.period} after ${waitTimeoutS}s — the worker has not consumed every commission event; fix the worker or raise --wait-timeout, then re-run the same command`);
    }
    await sleep(pollMs);
  }
}

async function getEstimate(client, businessId, period) {
  return client.request('GET', `/v1/businesses/${businessId}/commissions/periods/${period}/estimate`);
}

async function generateAndReview(client, ctx) {
  const view = await client.request('POST', `/v1/businesses/${ctx.businessId}/commission-statements/${ctx.period}/generate`, {
    pattern: '/v1/businesses/:businessId/commission-statements/:period/generate',
    idem: `trial-generate-${ctx.runId}-${hashOf([ctx.businessId, ctx.period])}`,
  });
  if (view.reader_scope !== 'BUSINESS') refuse(`the trial user must read commissions business-wide, got scope ${view.reader_scope}`);
  const reviewBody = { expected_fingerprint: view.current_fingerprint, expected_statement_fingerprint: view.current_statement_fingerprint };
  return client.request('POST', `/v1/businesses/${ctx.businessId}/commission-statements/${ctx.period}/review`, {
    pattern: '/v1/businesses/:businessId/commission-statements/:period/review',
    idem: `trial-review-${ctx.runId}-${hashOf([ctx.businessId, ctx.period, JSON.stringify(reviewBody)])}`, body: reviewBody,
  });
}

function printSummary(opts, ctx, times, counts, sent, estimate, review) {
  console.log('--- commission-approval-trial summary ---');
  console.log(`company ${opts.company} business ${ctx.businessId} branch ${ctx.branchId} period ${ctx.period}`);
  console.log(`employees ${counts.employees} services ${counts.services} customers ${counts.customers} sessions ${counts.sessions} lines ${counts.accepted}/${opts.lines}`);
  console.log(`setup ${times.setupMs}ms record ${times.recordMs}ms wait ${times.waitMs}ms generate+review ${times.writeMs}ms total ${times.totalMs}ms; HTTP requests ${sent}`);
  console.log(`estimate total ${estimate.total} review status ${review.status}`);
  console.log(`next manual steps (docs/runbook.md, commission-approval activation): enable the switch (pnpm platform:commission-approval --company <uuid> --enable ...), issue the coverage proof (pnpm platform:commission-coverage --company <uuid> --businesses <uuid> --from <first-day> --to <last-day> ...), approve the REVIEWED statement from the admin ONCE and read http.ms of the request that answered status 200 for the route /v1/businesses/:businessId/commission-statements/:period/approve in the api logs ("request completed"); the real company is enabled only if that measured approval is under 200 ms.`);
}

async function run(opts) {
  const client = makeClient(STAGING_ORIGIN, opts.company.toLowerCase(), opts.retryBackoffMs);
  await signIn(client);
  const ctx = await preflight(client, opts);
  console.log(`preflight ok: branch ${ctx.branchId} tz ${ctx.timezone} period ${ctx.period} business created ${ctx.createdMonth} statement DRAFT`);
  if (opts.dryRun) { console.log('dry-run: stopping before any write'); return; }
  const started = Date.now();
  const services = await ensureServices(client, ctx.businessId);
  const customers = await ensureCustomers(client, ctx.businessId);
  const employees = await ensureEmployees(client, { businessId: ctx.businessId, branchId: ctx.branchId, period: ctx.period, runId: ctx.runId, employees: opts.employees });
  await ensureSalariesAndPlans(client, { businessId: ctx.businessId, runId: ctx.runId, period: ctx.period, employeeIds: employees.map((e) => e.id) });
  const setupMs = Date.now() - started;
  const recordStarted = Date.now();
  const sessionCtx = { businessId: ctx.businessId, branchId: ctx.branchId, period: ctx.period, timezone: ctx.timezone, recorderMembershipId: ctx.recorderMembershipId, runId: ctx.runId, services, customers, employees, lines: opts.lines, linesPerSession: opts.linesPerSession, days: daysInPeriod(ctx.period) };
  const recording = await recordSessions(client, sessionCtx, opts.delayMs);
  const recordMs = Date.now() - recordStarted;
  const waitStarted = Date.now();
  const estimate = await waitConvergence(client, { businessId: ctx.businessId, period: ctx.period }, recording.lineIds, opts.pollMs, opts.waitTimeoutS);
  const waitMs = Date.now() - waitStarted;
  const writeStarted = Date.now();
  const review = await generateAndReview(client, { businessId: ctx.businessId, period: ctx.period, runId: ctx.runId });
  const writeMs = Date.now() - writeStarted;
  printSummary(opts, ctx, { setupMs, recordMs, waitMs, writeMs, totalMs: Date.now() - started }, { employees: employees.length, services: services.length, customers: customers.length, sessions: recording.sessionCount, accepted: recording.accepted }, client.sentCount(), estimate, review);
}

async function main() {
  try {
    const opts = parseCli(process.argv.slice(2));
    guard(opts);
    await run(opts);
  } catch (error) {
    process.exitCode = reportFailure(error);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  assertPeriodStable, daysInPeriod, guard, localDateIn, localMinutesOfDay, main, ownedSources,
  previousPeriod, reportFailure, resolvePeriod, runIdOf, sessionBody, shiftPeriod, sourceRefs,
  trialEmployeeName, trialEmployeeNames, zonedNoonIso,
};
