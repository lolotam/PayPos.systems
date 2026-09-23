import { randomBytes } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPlatformUser, type AuthService } from '@pospay/auth';

// Demo data (plan v4 T8): one company per vertical, generic names, created through the same audited, idempotent
// routes as production — POST /v1/companies, /v1/businesses, /v1/businesses/:id/branches — never a raw seed. Each run
// reconciles: whatever a failed run left out is created, nothing is created twice.
export const DEMO_OPERATOR = 'demo-operator@pospay.local';
export const DEMO_VERTICALS = ['restaurant', 'salon', 'laundry', 'retail', 'services'] as const;
const title = (vertical: string) => (vertical[0]?.toUpperCase() ?? '') + vertical.slice(1);
export const demoName = (vertical: string) => `Demo ${title(vertical)}`;

/** What already exists for one vertical, read by the caller as the operator (pospay_owner). */
export interface DemoState {
  readonly companyId: string | null;
  readonly businessId: string | null;
  readonly hasBranch: boolean;
}

export interface DemoDependencies {
  readonly app: NestFastifyApplication;
  readonly auth: AuthService;
  /** Grants the demo operator create:companies:platform — idempotent, as pospay_owner. */
  readonly grant: (email: string) => Promise<void>;
  /** The demo operator's user id, or null before the first run. */
  readonly operatorId: () => Promise<string | null>;
  readonly state: (operatorId: string, vertical: string) => Promise<DemoState>;
  /** An origin the API trusts, for the set-password and sign-in calls. */
  readonly origin: string;
  readonly planId: string;
  /** Test hook: called after each write, so a test can stop a run half-way. */
  readonly afterStep?: (step: string) => void;
}

async function post(
  deps: DemoDependencies,
  url: string,
  headers: Record<string, string>,
  body: object,
): Promise<Record<string, unknown>> {
  const res = await deps.app.inject({ method: 'POST', url, headers, payload: body });
  if (res.statusCode >= 300) throw new Error(`demo data: ${url} answered ${res.statusCode}`);
  return res.json() as Record<string, unknown>;
}

// A fresh one-time link each run: the password is random, never shown, and replaced every time.
async function signIn(deps: DemoDependencies): Promise<{ operatorId: string; cookie: string }> {
  const existing = await deps.operatorId();
  const redirectTo = `${deps.origin}/set-password`;
  const { userId, link } =
    existing === null
      ? await createPlatformUser(deps.auth, {
          email: DEMO_OPERATOR,
          name: 'Demo Operator',
          operator: 'demo-data',
          redirectTo,
        })
      : { userId: existing, link: await deps.auth.issuePasswordSetLink(existing, redirectTo) };
  const password = randomBytes(24).toString('base64url');
  const token = new URL(link).pathname.split('/').pop() ?? '';
  const headers = { origin: deps.origin };
  await post(deps, '/v1/auth/reset-password', headers, { token, newPassword: password });
  await deps.grant(DEMO_OPERATOR);
  const res = await deps.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers,
    payload: { email: DEMO_OPERATOR, password },
  });
  const cookies = res.headers['set-cookie'];
  const cookie = (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((c) => c.split(';')[0])
    .join('; ');
  return { operatorId: userId, cookie };
}

async function completeVertical(
  deps: DemoDependencies,
  cookie: string,
  state: DemoState,
  vertical: string,
): Promise<number> {
  const name = demoName(vertical);
  let written = 0;
  let companyId = state.companyId;
  if (companyId === null) {
    const key = { cookie, 'idempotency-key': `demo-company-${vertical}` };
    const company = await post(deps, '/v1/companies', key, { name_en: name, plan_id: deps.planId });
    companyId = company['id'] as string;
    written += 1;
    deps.afterStep?.(`${vertical}:company`);
  }
  const headers = { cookie, 'x-company-id': companyId };
  let businessId = state.businessId;
  if (businessId === null) {
    const key = { ...headers, 'idempotency-key': `demo-business-${vertical}` };
    const body = { vertical_type: vertical, name_en: name };
    businessId = (await post(deps, '/v1/businesses', key, body))['id'] as string;
    written += 1;
    deps.afterStep?.(`${vertical}:business`);
  }
  if (!state.hasBranch) {
    const key = { ...headers, 'idempotency-key': `demo-branch-${vertical}` };
    const url = `/v1/businesses/${businessId}/branches`;
    await post(deps, url, key, { name_en: `${name} — Main Branch` });
    written += 1;
    deps.afterStep?.(`${vertical}:branch`);
  }
  return written;
}

/**
 * Makes sure every demo vertical has its company, business and branch, creating only what is missing.
 *
 * @param deps the in-process API, its auth service, the operator reads, the grant function, an origin and the plan
 * @returns how many rows (companies, businesses, branches) this run created
 */
export async function createDemoData(deps: DemoDependencies): Promise<number> {
  const session = await signIn(deps);
  let written = 0;
  for (const vertical of DEMO_VERTICALS) {
    const state = await deps.state(session.operatorId, vertical);
    written += await completeVertical(deps, session.cookie, state, vertical);
  }
  return written;
}
