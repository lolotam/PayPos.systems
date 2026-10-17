import { afterAll, beforeAll, expect, it } from 'vitest';
import { inAppNotificationPage, recordServiceSessionResponse } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import { SYSTEM_ROLES } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { createLogger } from '@pospay/observability';
import { createPriceEditNoticeConsumer } from '../../../../../worker/src/modules/orders/index.ts';
import { createInAppTestModule } from '../../../../../worker/src/outbox/__tests__/late-service-session-inbox.ts';
import { createDeliverer } from '../../../../../worker/src/outbox/deliver.ts';
import { ids, must, editFixture, type EditFixture } from './session.fixture.ts';

let f: EditFixture;
beforeAll(async () => { f = await editFixture(); });
afterAll(async () => { await f?.close(); });

const editInput = (expected = 1) => ({ price: '26.000', discount: { kind: 'AMOUNT' as const, amount: '0.000' }, reason: 'Synthetic edit reason', expected_revision: expected });
const editUrl = (sessionId: string, lineId: string) => `/v1/businesses/${f.business}/branches/${f.branch}/service-sessions/${sessionId}/lines/${lineId}`;

it('delivery test 10 / LE-21 an HTTP edit rings one in-app notice named with the employee snapshot', async () => {
  const visit = await savedVisit();
  const edited = await f.h.send('PATCH', editUrl(visit.sessionId, visit.lineId), { cookie: f.editorCookie, company: f.company, key: ids.newId(), body: editInput() });
  expect(edited.status).toBe(200);
  const sourceId = await deliver(visit.sessionId);
  expect(await labels(visit.sessionId)).toEqual({ ar: 'ليلى', en: 'Layla Editor' });
  const inbox = await f.h.send('GET', '/v1/me/notifications', { cookie: f.editorCookie, company: f.company });
  expect(inbox.status).toBe(200);
  expect(JSON.stringify(inAppNotificationPage.parse(inbox.body))).toContain('ليلى');
  expect(await f.h.owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceId}`).toHaveLength(0);
}, 60_000);

it('LE-22 an owner, an accountant and a custom role are labelled by role', async () => {
  const accountant = await member('session-accountant-editor@example.test', 'accountant', true);
  const custom = await member('session-custom-editor@example.test', 'lead_stylist', false, 'مصففة أولى', 'Lead stylist');
  expect(await editedLabel(f.ownerCookie)).toEqual({ ar: 'المالك', en: 'Owner' });
  expect(await editedLabel(accountant)).toEqual({ ar: 'محاسب', en: 'Accountant' });
  expect(await editedLabel(custom)).toEqual({ ar: 'مصففة أولى', en: 'Lead stylist' });
}, 60_000);

it('LE-23 deactivating, renaming or relinking the employee keeps the committed label', async () => {
  const visit = await savedVisit();
  expect((await f.h.send('PATCH', editUrl(visit.sessionId, visit.lineId), { cookie: f.editorCookie, company: f.company, key: ids.newId(), body: editInput() })).status).toBe(200);
  const renamed = 'Renamed Editor';
  await f.h.owner`UPDATE employees SET user_id=${f.ownerId},name_en=${renamed},name_en_key=${employeeNameMatchKey(renamed)},name_ar=NULL,name_ar_key=NULL,deleted_at=${new Date().toISOString()}
    WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  try {
    await deliver(visit.sessionId);
    expect(await labels(visit.sessionId)).toEqual({ ar: 'ليلى', en: 'Layla Editor' });
    const [history] = await f.h.owner`SELECT editor_name_ar,editor_name_en FROM service_line_edits WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
    expect(history).toEqual({ editor_name_ar: 'ليلى', editor_name_en: 'Layla Editor' });
  } finally {
    await f.h.owner`UPDATE employees SET user_id=${f.editorId},name_en='Layla Editor',name_en_key=${employeeNameMatchKey('Layla Editor')},name_ar='ليلى',name_ar_key=${employeeNameMatchKey('ليلى')},deleted_at=NULL
      WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  }
}, 60_000);

it('LE-23 renaming the company role after the edit keeps the committed role label', async () => {
  const cookie = await member('session-role-rename-editor@example.test', 'senior_stylist', false, 'مصففة أولى', 'Lead stylist');
  const visit = await savedVisit();
  expect((await f.h.send('PATCH', editUrl(visit.sessionId, visit.lineId), { cookie, company: f.company, key: ids.newId(), body: editInput() })).status).toBe(200);
  await f.h.owner`UPDATE roles SET name_en='Renamed role',name_ar='اسم جديد' WHERE company_id=${f.company} AND code='senior_stylist'`;
  await deliver(visit.sessionId);
  expect(await labels(visit.sessionId)).toEqual({ ar: 'مصففة أولى', en: 'Lead stylist' });
  const [history] = await f.h.owner`SELECT editor_role_name_ar,editor_role_name_en FROM service_line_edits WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
  expect(history).toEqual({ editor_role_name_ar: 'مصففة أولى', editor_role_name_en: 'Lead stylist' });
}, 60_000);

async function editedLabel(cookie: string) {
  const visit = await savedVisit();
  const response = await f.h.send('PATCH', editUrl(visit.sessionId, visit.lineId), { cookie, company: f.company, key: ids.newId(), body: editInput() });
  expect(response.status).toBe(200);
  await deliver(visit.sessionId);
  return labels(visit.sessionId);
}

async function savedVisit() {
  const response = await f.h.send('POST', f.base, { cookie: f.ownerCookie, company: f.company, key: ids.newId(), body: { customer_id: f.customer, lines: [f.line()] } });
  expect(response.status).toBe(201);
  const session = recordServiceSessionResponse.parse(response.body).session;
  return { sessionId: session.id, lineId: must(session.lines[0]).id };
}

async function member(email: string, code: string, system: boolean, nameAr?: string, nameEn?: string) {
  const cookie = await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = must(users[0])['id'] as string;
  const membership = ids.newId();
  if (system) {
    const role = must(SYSTEM_ROLES.find((item) => item.code === code)).id;
    await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
      VALUES(${f.company},${membership},${userId},${role},'global','BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
    await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${ids.newId()},${membership},'edit:service-line-prices:branch','ALLOW','BRANCH',${f.branch},'Synthetic edit grant',${f.ownerId})`;
    return cookie;
  }
  const role = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en,name_ar) VALUES(${role},${f.company},${code},${must(nameEn)},${nameAr ?? null})`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES(${role},${f.company},${f.company},'edit:service-line-prices:branch')`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membership},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return cookie;
}

async function deliver(sessionId: string) {
  const clock = { now: () => new Date() };
  const consumer = createPriceEditNoticeConsumer(ids, clock);
  const notices = createDeliverer(f.db, [consumer], createLogger('silent'), { knownEventTypes: consumer.eventTypes });
  const rows = await f.h.owner`SELECT * FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  expect(rows).toHaveLength(1);
  const row = must(rows[0]);
  const event: ClaimedEvent = { companyId: f.company, id: row['id'] as string, aggregateType: 'service_session', aggregateId: sessionId, eventType: 'ServiceLineChanged', payload: row['payload'], attempt: 1 };
  expect(await notices(event)).toEqual({ delivered: true });
  const requests = await f.h.owner`SELECT * FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineEditNoticeRequested'`;
  expect(requests).toHaveLength(1);
  const request = must(requests[0]);
  const module = createInAppTestModule(f.db, ids, clock);
  const inbox = createDeliverer(f.db, [module.consumer], createLogger('silent'), { knownEventTypes: module.eventTypes });
  expect(await inbox({ ...event, id: request['id'] as string, eventType: 'ServiceLineEditNoticeRequested', payload: request['payload'] })).toEqual({ delivered: true });
  return request['id'] as string;
}

async function labels(sessionId: string) {
  const [row] = await f.h.owner`SELECT n.safe_parameters FROM in_app_notifications n
    JOIN outbox o ON o.company_id=n.company_id AND o.id=n.source_event_id
    WHERE n.company_id=${f.company} AND o.aggregate_id=${sessionId} AND o.event_type='ServiceLineEditNoticeRequested' LIMIT 1`;
  const parameters = row?.['safe_parameters'] as { name: string; value: string }[];
  const value = (name: string) => parameters.find((item) => item.name === name)?.value;
  return { ar: value('editor_name_ar'), en: value('editor_name_en') };
}
