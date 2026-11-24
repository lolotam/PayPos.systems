import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import {
  invitationsPageStatement,
  listMemberInvitations,
} from '../queries/member-invitations.query.ts';

// قائمة الدعوات (076 G1): شكل النتيجة على المسار الحقيقي، و can_reissue بالحالة المعروضة،
// وخطة EXPLAIN الفعلية على بيانات ممثلة لجملة الصفحة نفسها اللي بتشتغل في الإنتاج.
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
const readPage = (actor: string, page: { limit: number; cursor?: string }) =>
  listMemberInvitations(
    database(),
    { companyId: company, userId: actor },
    page,
    (userId) => h.auth.members.hasPassword(userId),
  );

describe('the invitations list query', () => {
  it('projects the page shape, hides the member who set a password behind ACTIVE, and paginates by id', async () => {
    const first = await invite('query-a@example.test');
    expect((await invite('query-b@example.test')).status).toBe(201);
    const token = new URL(first.body['set_password_link'] as string).pathname.split('/').pop() ?? '';
    const consumed = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      headers: { origin: 'http://admin.test' },
      payload: { token, newPassword: 'query-chosen-pass' },
    });
    expect(consumed.statusCode).toBe(200);
    const page = await readPage(owner.userId, { limit: 1 });
    expect(page['items']).toHaveLength(1);
    expect(page['next_cursor']).not.toBeNull();
    // العضو الأول حط كلمة مروره: بيتعرض ACTIVE وزر الإصدار مش ظاهر ليه، رغم إن المخزّن PENDING.
    expect(page['items'][0]).toMatchObject({
      role_code: 'accountant',
      scope_type: 'COMPANY',
      scope_id: company,
      state: 'ACTIVE',
      can_reissue: false,
    });
    expect(page['items'][0]).not.toHaveProperty('set_password_link');
    const rest = await readPage(owner.userId, { limit: 20, cursor: page['next_cursor'] ?? undefined });
    expect(rest['items'].map((row) => [row['state'], row['can_reissue']])).toEqual([['PENDING', true]]);
    expect(rest['next_cursor']).toBeNull();
  });

  it('shows can_reissue only to the owner who created the invitation', async () => {
    const other = await readPage(
      '01920000-0000-7000-8000-0000000000aa',
      { limit: 20 },
    );
    expect(other['items'].every((row) => row['can_reissue'] === false)).toBe(true);
  });
});

/** كل عقد في شجرة خطة EXPLAIN. */
function planNodes(node: Record<string, unknown>): Record<string, unknown>[] {
  const children = (node['Plans'] as Record<string, unknown>[] | undefined) ?? [];
  return [node, ...children.flatMap(planNodes)];
}

describe('the invitations page statement plan', () => {
  it('reads the primary key (company_id, id) with an Index Cond on representative data', async () => {
    // خمس شركات بـ 400 دعوة لكل واحدة: من غير بيانات ممثلة المخطط بيختار مسح متسلسل على جدول فاضي.
    const companies = [company];
    for (let index = 0; index < 4; index += 1) {
      companies.push(await h.onboard(owner.cookie, `G1 Plan ${index}`));
    }
    for (const id of companies) {
      await h.owner`
        INSERT INTO member_invitations
          (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state)
        SELECT ${id}, gen_random_uuid(), md5(random()::text) || md5(random()::text),
               'accountant', 'COMPANY', ${id}, ${owner.userId}, 'PENDING'
        FROM generate_series(1, 400)`;
    }
    await h.owner`ANALYZE member_invitations`;
    const plan = await database().withTenant(company, async (tx: Tx) => {
      const [row] = await tx.execute<{ 'QUERY PLAN': Record<string, unknown>[] }>(
        sql`EXPLAIN (FORMAT JSON) ${invitationsPageStatement(company, undefined, 21)}`,
      );
      return (row?.['QUERY PLAN'] ?? [])[0]?.['Plan'] as Record<string, unknown>;
    });
    const nodes = planNodes(plan);
    expect(nodes.map((node) => node['Node Type'])).not.toContain('Seq Scan');
    const scan = nodes.find((node) => node['Index Name'] === 'member_invitations_pkey');
    expect(scan).toBeDefined();
    expect(String(scan?.['Index Cond'])).toContain('company_id');
  });
});
