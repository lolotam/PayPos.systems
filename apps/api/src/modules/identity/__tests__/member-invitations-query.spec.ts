import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { listMemberInvitations } from '../queries/member-invitations.query.ts';

// قائمة الدعوات (076 G1): اختبار شكل النتيجة على المسار الحقيقي، وتأكيد EXPLAIN ANALYZE إن
// القراءة بتلمس فهرس المفتاح الأساسي (company_id, id) وما بتعملش مسح جدول.
const ids = systemUuidV7();
let h: Harness;
const owner = { email: 'g1-query-owner@example.test', cookie: '', userId: '' };
let company: string;

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  owner.cookie = await h.signedInOperator(owner.email);
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${owner.email}`;
  owner.userId = (row?.['id'] as string) ?? '';
  company = await h.onboard(owner.cookie, 'G1 Query Company');
});

afterAll(async () => {
  await h?.close();
});

const invite = (email: string) =>
  h.send('POST', '/v1/memberships/invitations', {
    cookie: owner.cookie,
    company,
    body: {
      email,
      name: 'Queried',
      role: 'accountant',
      scope: { type: 'COMPANY', id: company },
      email_confirmed: true,
    },
  });

const database = () => h.app.get(DATABASE);

const resetWithToken = (token: string, newPassword: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { origin: 'http://admin.test' },
    payload: { token, newPassword },
  });

const hasPassword = async (userId: string) =>
  (await h.auth.members.readMarker(userId))?.hasPassword ?? false;

describe('the invitations list query', () => {
  it('projects the page shape, hides the member who set a password behind ACTIVE, and paginates by id', async () => {
    const first = await invite('query-a@example.test');
    const second = await invite('query-b@example.test');
    expect(first.status).toBe(201);
    // العضو الأول حط كلمة مروره، فالقراءة الكسولة بتعرض الدعوة ACTIVE بدل PENDING.
    const token = new URL(first.body['set_password_link'] as string).pathname.split('/').pop() ?? '';
    expect((await resetWithToken(token, 'query-chosen-pass')).statusCode).toBe(200);
    const page = await listMemberInvitations(
      database(),
      { companyId: company, userId: owner.userId },
      { limit: 1 },
      hasPassword,
    );
    expect(page['items']).toHaveLength(1);
    expect(page['next_cursor']).not.toBeNull();
    const shown = page['items'][0];
    expect(shown).toMatchObject({
      role_code: 'accountant',
      scope_type: 'COMPANY',
      scope_id: company,
      state: 'ACTIVE',
    });
    expect(shown).not.toHaveProperty('set_password_link');
    const rest = await listMemberInvitations(
      database(),
      { companyId: company, userId: owner.userId },
      { limit: 20, cursor: page['next_cursor'] ?? undefined },
      hasPassword,
    );
    expect(rest['items'].map((row) => row['state'])).toEqual(['PENDING']);
    expect(second.status).toBe(201);
  });

  it('EXPLAIN ANALYZE reads the (company_id, id) index with no sequential scan', async () => {
    // بيانات ممثلة: من غيرهم المخطط بيختار مسح متسلسل على جدول شبه فاضي والمؤشر ما يظهرش.
    const rows = Array.from({ length: 60 }, () => ids.newId());
    await database().withTenant(
      company,
      async (tx: Tx) => {
        for (const id of rows) {
          await tx.execute(sql`
            INSERT INTO member_invitations
              (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state)
            VALUES (${company}, ${id}, ${id}, 'accountant', 'COMPANY', ${company}, ${owner.userId}, 'PENDING')`);
        }
        const plan = JSON.stringify(
          await tx.execute(sql`
            EXPLAIN (ANALYZE, FORMAT JSON)
            SELECT id, user_id, role_code, scope_type, scope_id, state, link_issued_at, created_at
            FROM member_invitations
            WHERE company_id = ${company}
            ORDER BY id LIMIT 21`),
        );
        expect(plan).toContain('member_invitations_pkey');
        expect(plan).toContain('Index Cond');
        expect(plan).not.toContain('Seq Scan');
      },
      { readOnly: true },
    );
  });
});
