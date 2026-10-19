import { systemUuidV7 } from '@pospay/ids';
import { inAppNotificationPage } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../../test/harness.ts';

let h: Harness;
let cookie: string;
let otherCookie: string;
let company: string;
let otherCompany: string;
let user: string;
let otherUser: string;
const ids = systemUuidV7();
const mine = ids.newId();
const theirs = ids.newId();
const otherTenant = ids.newId();
const anotherMine = ids.newId();

beforeAll(async () => {
  h = await startHarness();
  cookie = await h.signedInOperator('in-app-owner@example.test');
  otherCookie = await h.signedInOperator('in-app-member@example.test');
  company = await h.onboard(cookie, 'In App Company');
  otherCompany = await h.onboard(otherCookie, 'Other Inbox Company');
  [user, otherUser] = (
    await h.owner<
      { id: string }[]
    >`SELECT id FROM "user" WHERE email IN ('in-app-owner@example.test','in-app-member@example.test') ORDER BY email DESC`
  ).map((r) => r.id) as [string, string];
  const [role] = await h.owner`SELECT id FROM roles WHERE code = 'staff' AND company_id IS NULL`;
  await h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${ids.newId()},${otherUser},${role?.['id']},'global','COMPANY',${company})`;
  for (const [id, recipient, tenant] of [
    [mine, user, company],
    [anotherMine, user, company],
    [theirs, otherUser, company],
    [otherTenant, user, otherCompany],
  ] as const) {
    await h.owner`INSERT INTO in_app_notifications (company_id,id,recipient_user_id,source_event_id,template_key,
      template_revision,locale,safe_parameters,created_at) VALUES (${tenant},${id},${recipient},${ids.newId()},
      'generic_notice',1,'en','[{"name":"subject","type":"text","value":"Synthetic subject"}]',now())`;
  }
});

it.each(['future', 'expired'] as const)(
  'refuses %s memberships before every tenant query',
  async (state) => {
    await h.owner`UPDATE memberships SET starts_at =
    ${state === 'future' ? '2100-01-01T00:00:00Z' : '2000-01-01T00:00:00Z'},
    ends_at = ${state === 'future' ? null : '2001-01-01T00:00:00Z'}
    WHERE company_id = ${company} AND user_id = ${otherUser}`;
    try {
      h.calls.tenant.length = 0;
      for (const [method, path] of [
        ['GET', ''],
        ['GET', '/unread-count'],
        ['POST', `/${theirs}/read`],
        ['POST', '/read-all'],
      ] as const) {
        expect(
          (await h.send(method, `/v1/me/notifications${path}`, { cookie: otherCookie, company }))
            .status,
        ).toBe(403);
      }
      expect(h.calls.tenant).toHaveLength(0);
    } finally {
      await h.owner`UPDATE memberships SET starts_at = '2000-01-01T00:00:00Z',ends_at = NULL
      WHERE company_id = ${company} AND user_id = ${otherUser}`;
    }
  },
);
afterAll(async () => {
  await h.close();
});

it.each([
  ['GET', ''],
  ['GET', '/unread-count'],
  ['POST', `/${mine}/read`],
  ['POST', '/read-all'],
] as const)(
  'refuses closed company on %s /me/notifications%s despite active membership',
  async (method, path) => {
    const before =
      await h.owner`SELECT id,read_at FROM in_app_notifications WHERE company_id = ${company} ORDER BY id`;
    await h.owner`UPDATE companies SET deleted_at = now() WHERE id = ${company}`;
    try {
      const result = await h.send(method, `/v1/me/notifications${path}`, { cookie, company });
      expect(result.status).toBe(403);
      expect(result.body['code']).toBe('FORBIDDEN');
      expect(
        await h.owner`SELECT id,read_at FROM in_app_notifications WHERE company_id = ${company} ORDER BY id`,
      ).toEqual(before);
    } finally {
      await h.owner`UPDATE companies SET deleted_at = NULL WHERE id = ${company}`;
    }
  },
);

it('lists and counts only session user in selected company, including a member without log permission', async () => {
  const own = await h.send('GET', '/v1/me/notifications', { cookie, company });
  expect(own.status).toBe(200);
  expect(
    inAppNotificationPage
      .parse(own.body)
      .items.map((r) => r.id)
      .sort(),
  ).toEqual([mine, anotherMine].sort());
  expect(
    (await h.send('GET', '/v1/me/notifications/unread-count', { cookie, company })).body,
  ).toEqual({ count: 2 });
  const other = await h.send('GET', '/v1/me/notifications', { cookie: otherCookie, company });
  expect(other.status).toBe(200);
  expect(inAppNotificationPage.parse(other.body).items.map((r) => r.id)).toEqual([theirs]);
  expect(
    (await h.send('GET', '/v1/notifications/delivery-log', { cookie: otherCookie, company }))
      .status,
  ).toBe(403);
});

it('read is idempotent, preserves first time, and foreign or absent ids are indistinguishable no-ops', async () => {
  for (const id of [theirs, otherTenant, ids.newId(), mine, mine]) {
    const result = await h.send('POST', `/v1/me/notifications/${id}/read`, { cookie, company });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  }
  const [first] = await h.owner`SELECT read_at FROM in_app_notifications WHERE id = ${mine}`;
  await h.send('POST', `/v1/me/notifications/${mine}/read`, { cookie, company });
  const [second] = await h.owner`SELECT read_at FROM in_app_notifications WHERE id = ${mine}`;
  expect(second?.['read_at']).toEqual(first?.['read_at']);
  expect(
    (await h.send('GET', '/v1/me/notifications/unread-count', { cookie, company })).body,
  ).toEqual({ count: 1 });
  const listAfterRead = await h.send('GET', '/v1/me/notifications', { cookie, company });
  const unreadItems = inAppNotificationPage
    .parse(listAfterRead.body)
    .items.filter((i) => i.read_at === null);
  expect(unreadItems).toHaveLength(1);
  const others =
    await h.owner`SELECT read_at FROM in_app_notifications WHERE id IN (${theirs},${otherTenant})`;
  expect(others.every((r) => r['read_at'] === null)).toBe(true);
});

it('read-all is idempotent and cannot affect another user or company', async () => {
  const [before] = await h.owner`SELECT read_at FROM in_app_notifications WHERE id = ${mine}`;
  for (let n = 0; n < 2; n += 1) {
    const result = await h.send('POST', '/v1/me/notifications/read-all', { cookie, company });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  }
  expect(
    (await h.send('GET', '/v1/me/notifications/unread-count', { cookie, company })).body,
  ).toEqual({ count: 0 });
  const listAfterReadAll = await h.send('GET', '/v1/me/notifications', { cookie, company });
  const unreadAfterAll = inAppNotificationPage
    .parse(listAfterReadAll.body)
    .items.filter((i) => i.read_at === null);
  expect(unreadAfterAll).toHaveLength(0);
  const [after] = await h.owner`SELECT read_at FROM in_app_notifications WHERE id = ${mine}`;
  expect(after?.['read_at']).toEqual(before?.['read_at']);
  expect(
    (
      await h.owner`SELECT read_at FROM in_app_notifications WHERE id IN (${theirs},${otherTenant})`
    ).every((r) => r['read_at'] === null),
  ).toBe(true);
});

it('cannot list, count, read or read-all notification of another company even with valid membership there', async () => {
  const otherCompanyRow = ids.newId();
  await h.owner`INSERT INTO in_app_notifications (company_id,id,recipient_user_id,source_event_id,template_key,
    template_revision,locale,safe_parameters,created_at) VALUES (${otherCompany},${otherCompanyRow},${otherUser},
    ${ids.newId()},'generic_notice',1,'en','[{"name":"subject","type":"text","value":"Synthetic subject"}]',now())`;

  const inCompany = await h.send('GET', '/v1/me/notifications', { cookie: otherCookie, company });
  expect(inAppNotificationPage.parse(inCompany.body).items.map((r) => r.id)).toEqual([theirs]);
  expect(
    (await h.send('GET', '/v1/me/notifications/unread-count', { cookie: otherCookie, company }))
      .body,
  ).toEqual({ count: 1 });

  const readOther = await h.send('POST', `/v1/me/notifications/${otherCompanyRow}/read`, {
    cookie: otherCookie,
    company,
  });
  expect(readOther.status).toBe(200);
  const [otherRowAfterRead] =
    await h.owner`SELECT read_at FROM in_app_notifications WHERE id = ${otherCompanyRow}`;
  expect(otherRowAfterRead?.['read_at']).toBeNull();

  const readAllCompany = await h.send('POST', '/v1/me/notifications/read-all', {
    cookie: otherCookie,
    company,
  });
  expect(readAllCompany.status).toBe(200);
  const [theirsAfter] =
    await h.owner`SELECT read_at FROM in_app_notifications WHERE id = ${theirs}`;
  expect(theirsAfter?.['read_at']).not.toBeNull();
  const [otherRowAfterAll] =
    await h.owner`SELECT read_at FROM in_app_notifications WHERE id = ${otherCompanyRow}`;
  expect(otherRowAfterAll?.['read_at']).toBeNull();

  const inOtherCompany = await h.send('GET', '/v1/me/notifications', {
    cookie: otherCookie,
    company: otherCompany,
  });
  expect(inAppNotificationPage.parse(inOtherCompany.body).items.map((r) => r.id)).toEqual([
    otherCompanyRow,
  ]);
  expect(
    (
      await h.send('GET', '/v1/me/notifications/unread-count', {
        cookie: otherCookie,
        company: otherCompany,
      })
    ).body,
  ).toEqual({ count: 1 });
});

it('requires session, valid selected company, active membership and valid ids/cursors', async () => {
  h.calls.tenant.length = 0;
  expect(
    (await h.send('GET', '/v1/me/notifications', { cookie, company: otherCompany })).status,
  ).toBe(403);
  expect(h.calls.tenant).not.toContain(otherCompany);
  expect((await h.send('GET', '/v1/me/notifications', { cookie: '', company })).status).toBe(401);
  expect((await h.send('GET', '/v1/me/notifications', { cookie })).status).toBe(400);
  expect(
    (await h.send('GET', '/v1/me/notifications', { cookie, company: 'bad-company-id' })).status,
  ).toBe(400);
  expect((await h.send('GET', '/v1/me/notifications?cursor=bad', { cookie, company })).status).toBe(
    400,
  );
  expect((await h.send('POST', '/v1/me/notifications/bad/read', { cookie, company })).status).toBe(
    400,
  );
  await h.owner`DELETE FROM memberships WHERE company_id = ${company} AND user_id = ${otherUser}`;
  for (const [method, path] of [
    ['GET', ''],
    ['GET', '/unread-count'],
    ['POST', `/${theirs}/read`],
    ['POST', '/read-all'],
  ] as const) {
    expect(
      (await h.send(method, `/v1/me/notifications${path}`, { cookie: otherCookie, company }))
        .status,
    ).toBe(403);
  }
});
