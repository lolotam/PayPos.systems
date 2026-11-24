import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

// AC-G1-6: لوج الـ API على مسار الدعوة كله — دعوة، فتح الرابط، استهلاكه، رفض مكرر، إعادة إصدار،
// وقراءة القائمة — ما فيهوش الرابط ولا التوكن ولا كلمة المرور ولا الإيميل. والاختبار بيتأكد إن
// اللوج فعلاً سجّل الطلبات دي (من غير ده كان هينجح وهو فاضي).
const chunks: Buffer[] = [];
let h: Harness;

beforeAll(async () => {
  h = await startHarness({
    staffAccessRoutes: true,
    logs: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk as Buffer);
        callback();
      },
    }),
  });
});

afterAll(async () => {
  await h?.close();
});

it(
  'never writes the link, the token, the password or the email while the whole flow runs',
  { timeout: 90_000 },
  async () => {
    const cookie = await h.signedInOperator('g1-logs-owner@example.test');
    const company = await h.onboard(cookie, 'G1 Logs');
    const body = {
      email: 'logged-member@example.test',
      name: 'Logged',
      role: 'accountant',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
    };
    const invited = await h.send('POST', '/v1/memberships/invitations', { cookie, company, body });
    expect(invited.status).toBe(201);
    const link = invited.body['set_password_link'] as string;
    const first = new URL(link).pathname.split('/').pop() ?? '';
    await h.send('POST', '/v1/memberships/invitations', { cookie, company, body });
    const reissued = await h.send(
      'POST',
      `/v1/memberships/invitations/${invited.body['invitation_id']}/link`,
      { cookie, company },
    );
    const second =
      new URL(reissued.body['set_password_link'] as string).pathname.split('/').pop() ?? '';
    const url = new URL(reissued.body['set_password_link'] as string);
    await h.app.inject({
      method: 'GET',
      url: url.pathname + url.search,
      headers: { origin: 'http://admin.test' },
    });
    await h.app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      headers: { origin: 'http://admin.test' },
      payload: { token: second, newPassword: 'logged-secret-pass' },
    });
    await h.send('GET', '/v1/memberships/invitations', { cookie, company });
    const logs = Buffer.concat(chunks).toString('utf8');
    expect(logs.match(/request completed/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(logs).toContain('/v1/memberships/invitations');
    for (const secret of [
      first,
      second,
      link,
      'logged-secret-pass',
      'logged-member@example.test',
    ]) {
      expect(logs).not.toContain(secret);
    }
  },
);
