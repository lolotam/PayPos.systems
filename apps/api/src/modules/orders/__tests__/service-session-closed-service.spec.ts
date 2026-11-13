import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendServiceSessionLinesResponse, recordServiceSessionResponse } from '@pospay/contracts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
/** الخدمة المقفولة في الاختبارات: تُقفل مرة واحدة من مسار الكتالوج، فهي المقفولة الوحيدة هنا. */
let closedService: string;

beforeAll(async () => {
  f = await sessionFixture();
  closedService = must(f.services[2]);
  const closed = await f.h.send('POST', `/v1/businesses/${f.business}/services/${closedService}/close`, {
    cookie: f.ownerCookie,
    company: f.company,
    body: { expected_revision: 1 },
  });
  expect(closed.status).toBe(200);
});
afterAll(async () => { await f?.close(); });

const post = (body: object, url = f.base) =>
  f.h.send('POST', url, { cookie: f.cookie, company: f.company, key: ids.newId(), body });

/** عدد زيارات العميلة في القاعدة: رفض الزيارة ما يسيبش زيارة جديدة. */
const sessionCount = async (): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM service_sessions
    WHERE company_id=${f.company} AND customer_id=${f.customer}`;
  return Number(row?.['n'] ?? 0);
};

/** عدد أسطر الزيارات في القاعدة: رفض الإضافة ما يسيبش سطر جديد. */
const lineCount = async (): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM service_lines
    WHERE company_id=${f.company}`;
  return Number(row?.['n'] ?? 0);
};

/** حالات فتح خانات الباقة: رفض الزيارة ما يستهلكش خانة ولا يفتحها. */
const slotStates = async (): Promise<string[]> => {
  const rows = await f.h.owner`SELECT state FROM package_session_slots
    WHERE company_id=${f.company} ORDER BY id`;
  return rows.map((row) => row['state'] as string);
};

/** سطر مدفوع على موظفة مش موجودة: رفض الموظفة نفسه كان بيطلع قبل رفض الخدمة المقفولة. */
const lineWithUnknownEmployee = (service: string, price = '25.000') => ({
  ...f.line(service, price),
  performers: [{ employee_id: ids.newId() }],
});

it('a closed service is redeemed from a package slot when the visit is recorded', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30', serviceId: closedService });
  const response = await post({ customer_id: f.customer, lines: [packageLine(f, seeded.entitlement, closedService)] });
  expect(response.status).toBe(201);
  const recorded = recordServiceSessionResponse.parse(response.body);
  expect(recorded.outcome).toBe('COMPLETE');
  expect(recorded.session.lines[0]).toMatchObject({ service_id: closedService, price: '1.000' });
  const slots = await f.h.owner`SELECT state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement}`;
  expect(slots.map((slot) => slot['state'])).toEqual(['USED']);
});

it('the same closed service on a paid line is refused with 409 SERVICE_CLOSED and saves nothing', async () => {
  const sessionsBefore = await sessionCount();
  const linesBefore = await lineCount();
  const slotsBefore = await slotStates();
  const response = await post({ customer_id: f.customer, lines: [f.line(closedService)] });
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('SERVICE_CLOSED');
  expect(response.body['details']).toEqual({ service_id: closedService });
  expect(await sessionCount()).toBe(sessionsBefore);
  expect(await lineCount()).toBe(linesBefore);
  expect(await slotStates()).toEqual(slotsBefore);
});

it('a closed service is redeemed from a package slot when lines are appended', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30', serviceId: closedService });
  const created = await post({ customer_id: f.customer, lines: [f.line(must(f.services[3]), '15.000')] });
  expect(created.status).toBe(201);
  const sessionId = recordServiceSessionResponse.parse(created.body).session.id;
  const response = await post({ lines: [packageLine(f, seeded.entitlement, closedService)] }, `${f.base}/${sessionId}/lines`);
  expect(response.status).toBe(201);
  const appended = appendServiceSessionLinesResponse.parse(response.body);
  expect(appended.outcome).toBe('COMPLETE');
  expect(appended.added_lines[0]).toMatchObject({ service_id: closedService, price: '1.000' });
  const slots = await f.h.owner`SELECT state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement}`;
  expect(slots.map((slot) => slot['state'])).toEqual(['USED']);
});

it('the same closed service on an appended paid line is refused with 409 SERVICE_CLOSED and adds no line', async () => {
  const created = await post({ customer_id: f.customer, lines: [f.line(must(f.services[3]), '15.000')] });
  expect(created.status).toBe(201);
  const sessionId = recordServiceSessionResponse.parse(created.body).session.id;
  const linesBefore = await lineCount();
  const slotsBefore = await slotStates();
  const response = await post({ lines: [f.line(closedService, '7.125')] }, `${f.base}/${sessionId}/lines`);
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('SERVICE_CLOSED');
  expect(response.body['details']).toEqual({ service_id: closedService });
  expect(await lineCount()).toBe(linesBefore);
  expect(await slotStates()).toEqual(slotsBefore);
});

it('the closed service on a paid line is refused before the performer problem on the record path', async () => {
  // ترتيب الرفض محفوظ زي ما كان قبل الخدمة المقفولة: رفض الخدمة المقفولة كان بيطلع من قراءة
  // الكتالوج قبل تجهيز البند، فرفض الموظفة المجهولة ما يقدّمش عليه.
  const response = await post({ customer_id: f.customer, lines: [lineWithUnknownEmployee(closedService)] });
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('SERVICE_CLOSED');
});

it('the closed service on an appended paid line is refused before the performer problem', async () => {
  const created = await post({ customer_id: f.customer, lines: [f.line(must(f.services[3]), '15.000')] });
  expect(created.status).toBe(201);
  const sessionId = recordServiceSessionResponse.parse(created.body).session.id;
  const response = await post({ lines: [lineWithUnknownEmployee(closedService, '7.125')] }, `${f.base}/${sessionId}/lines`);
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('SERVICE_CLOSED');
});
