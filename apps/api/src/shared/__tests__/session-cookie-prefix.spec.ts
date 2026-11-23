import { Controller, Get, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { errorEnvelope } from '@pospay/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../test/harness.ts';
import { Authenticated } from '../access.decorators.ts';

// The environment prefix: staging reads its own cookie name only, so a production cookie is not a session.
const ORIGIN = 'http://admin.test';

@Controller('probe')
class ProtectedProbe {
  @Authenticated()
  @Get('me')
  me(@Req() request: FastifyRequest): { userId: string | null | undefined } {
    return { userId: request.principal?.userId };
  }
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ cookiePrefix: 'pospay-stg', controllers: [ProtectedProbe] });
});

afterAll(async () => {
  await h?.close();
});

describe('a session cookie prefixed by its environment', () => {
  it('signs in under this environment name and refuses a cookie from another environment', async () => {
    const cookie = await h.signedInOperator('prefix@example.test');
    expect(cookie).toContain('pospay-stg.session_token=');
    const other = cookie.replace('pospay-stg.session_token', 'pospay.session_token');
    const refused = await h.send('GET', '/v1/probe/me', { cookie: other });
    expect([refused.status, errorEnvelope.parse(refused.body).code]).toEqual([
      401,
      'UNAUTHENTICATED',
    ]);
    const allowed = await h.send('GET', '/v1/probe/me', { cookie });
    expect(allowed.status).toBe(200);
  });

  it('signs out under this environment name', async () => {
    const cookie = await h.signedInOperator('signout@example.test');
    const res = await h.send('POST', '/v1/auth/sign-out', {
      cookie,
      headers: { origin: ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('pospay-stg.session_token=');
  });
});
