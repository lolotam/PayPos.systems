import { randomBytes } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPlatformUser, type AuthService } from '@pospay/auth';

// Demo data (plan v4 T8): one company per vertical, generic names, created through the same audited, idempotent
// routes as production — POST /v1/companies, /v1/businesses, /v1/businesses/:id/branches — never a raw seed.
export const DEMO_OPERATOR = 'demo-operator@pospay.local';
const VERTICALS = ['restaurant', 'salon', 'laundry', 'retail', 'services'] as const;
const title = (vertical: string) => vertical[0]?.toUpperCase() + vertical.slice(1);

export interface DemoDependencies {
  readonly app: NestFastifyApplication;
  readonly auth: AuthService;
  /** Grants the demo operator create:companies:platform — pnpm platform:grant's function, as pospay_owner. */
  readonly grant: (email: string) => Promise<void>;
  /** An origin the API trusts, for the set-password and sign-in calls. */
  readonly origin: string;
  readonly planId: string;
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

async function signIn(deps: DemoDependencies): Promise<string> {
  const { link } = await createPlatformUser(deps.auth, {
    email: DEMO_OPERATOR,
    name: 'Demo Operator',
    operator: 'demo-data',
    redirectTo: `${deps.origin}/set-password`,
  });
  // Nobody signs in as the demo operator afterwards: its password is random and never shown.
  const password = randomBytes(24).toString('base64url');
  const token = new URL(link).pathname.split('/').pop() ?? '';
  const auth = { origin: deps.origin };
  await post(deps, '/v1/auth/reset-password', auth, { token, newPassword: password });
  await deps.grant(DEMO_OPERATOR);
  const res = await deps.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: auth,
    payload: { email: DEMO_OPERATOR, password },
  });
  const cookies = res.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((c) => c.split(';')[0])
    .join('; ');
}

/**
 * Creates the demo companies. Run once: the demo operator's email is the marker, so a second run finds it and
 * stops before writing anything.
 *
 * @param deps the in-process API, its auth service, the grant function, a trusted origin and the plan
 * @returns the ids of the companies created
 */
export async function createDemoData(deps: DemoDependencies): Promise<string[]> {
  const cookie = await signIn(deps);
  const companies: string[] = [];
  for (const vertical of VERTICALS) {
    const name = `Demo ${title(vertical)}`;
    const company = await post(
      deps,
      '/v1/companies',
      { cookie, 'idempotency-key': `demo-company-${vertical}` },
      { name_en: name, plan_id: deps.planId },
    );
    const headers = { cookie, 'x-company-id': company['id'] as string };
    const business = await post(
      deps,
      '/v1/businesses',
      { ...headers, 'idempotency-key': `demo-business-${vertical}` },
      { vertical_type: vertical, name_en: name },
    );
    await post(
      deps,
      `/v1/businesses/${business['id'] as string}/branches`,
      { ...headers, 'idempotency-key': `demo-branch-${vertical}` },
      { name_en: `${name} — Main Branch` },
    );
    companies.push(company['id'] as string);
  }
  return companies;
}
