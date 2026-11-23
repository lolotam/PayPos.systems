import { OWN_RATING_READS, type OwnRatingReads } from '../queries/own-rating-context.ts';
import { RATING_TENANT } from '../../../../../../packages/db/test/rating-fixtures.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownRatingFixture, personalOrigin, type OwnRatingFixture } from './own-rating.fixture.ts';

let f: OwnRatingFixture;
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));
const headers = () => ({ cookie: f.personalCookie, origin: personalOrigin });
const read = async (url = '/v1/staff/me/rating-summary') => {
  const response = await f.h.app.inject({ method: 'GET', url, headers: headers() });
  expect(response.headers['cache-control']).toBe('no-store');
  return response;
};
const staffHeaders = () => ({
  cookie: f.staffCookie,
  authorization: 'Device synthetic-device-token',
  origin: personalOrigin,
});
// المدير بيحفظ الأعمدة في إعدادات النشاط؛ null = افتراضي MY-Q3 اللي فيه rating_average (61-3).
const saveColumns = (columns: string[] | null) => f.h.owner`
  INSERT INTO business_settings (company_id, business_id, staff_columns)
  VALUES (${f.company}, ${f.business}, ${columns})
  ON CONFLICT (company_id, business_id) DO UPDATE SET staff_columns = EXCLUDED.staff_columns`;

beforeAll(async () => {
  f = await ownRatingFixture();
  // ساعة الأساس هي نفسها اللي كل اختبار بيرجّعلها في finally، فالاختبار الأول والأخير بيبدأوا من نفس اللحظة.
  f.setNow(at(10));
  // التقييمان بيتزرعوا مرة هنا، فكل من RS-05 وRS-05a يقدر يشتغل لوحده وبأي ترتيب.
  await f.seedStars([
    { employeeId: f.employeeId, stars: 4, at: at(2) },
    { employeeId: f.employeeId, stars: 5, at: at(3) },
  ]);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('RS-05 answers exactly HIDDEN with ratings present while the manager left rating_average out', async () => {
  await saveColumns(['date', 'tip']);
  try {
    const response = await read();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ visibility: 'HIDDEN' });
    expect(response.body).not.toMatch(/average|count|comment|customer|employee_id|stars/);
  } finally {
    await saveColumns(null);
  }
});

it('RS-05a a saved set that names rating_average makes the same ratings VISIBLE', async () => {
  await saveColumns(['rating_average']);
  try {
    expect((await read()).json()).toEqual({ visibility: 'VISIBLE', average: '4.5', count: 2 });
  } finally {
    await saveColumns(null);
  }
});

it('RS-06 shows the average and count with the MY-Q3 default, which includes rating_average', async () => {
  try {
    f.setNow(new Date(Date.UTC(2026, 6, 15, 12)));
    await f.seedStars([
      { employeeId: f.employeeId, stars: 4, at: new Date(Date.UTC(2026, 6, 4, 12)) },
      { employeeId: f.employeeId, stars: 5, at: new Date(Date.UTC(2026, 6, 5, 12)) },
    ]);
    expect((await read()).json()).toEqual({ visibility: 'VISIBLE', average: '4.5', count: 2 });
    f.setNow(new Date(Date.UTC(2026, 7, 15, 12)));
    await f.seedStars([
      { employeeId: f.employeeId, stars: 5, at: new Date(Date.UTC(2026, 7, 6, 13)) },
      { employeeId: f.employeeId, stars: 4, at: new Date(Date.UTC(2026, 7, 6, 14)) },
      { employeeId: f.employeeId, stars: 4, at: new Date(Date.UTC(2026, 7, 6, 15)) },
      { employeeId: f.employeeId, stars: 4, at: new Date(Date.UTC(2026, 7, 6, 16)) },
    ]);
    expect((await read()).json()).toEqual({ visibility: 'VISIBLE', average: '4.3', count: 4 });
  } finally {
    f.setNow(at(10));
  }
});

it('RS-07 answers VISIBLE with null average and count zero for a month without ratings', async () => {
  f.setNow(new Date(Date.UTC(2026, 8, 15, 12)));
  try {
    expect((await read()).json()).toEqual({ visibility: 'VISIBLE', average: null, count: 0 });
  } finally {
    f.setNow(at(10));
  }
});

it('RS-08 refuses a DENY, the customers feature off, and eligibility lost after the guard with 403', async () => {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},gen_random_uuid(),${f.membershipId},'read:ratings:own','DENY','BUSINESS',${f.business},'Synthetic own denial',${f.userId})`;
  try {
    const denied = await read();
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('FORBIDDEN');
    expect(denied.json()).not.toHaveProperty('average');
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membershipId} AND permission_code='read:ratings:own'`;
  }
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'customers',false,'Synthetic feature refusal',${f.userId})`;
  try {
    const off = await read();
    expect(off.statusCode).toBe(403);
    expect(off.json().code).toBe('FORBIDDEN');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='customers'`;
  }
  // الحارس بيمرّر الجلسة، وقارئ الأهلية بعده بيرفض (الارتباط ضاع): الرد 403 من غير أي بيانات.
  const reads = f.h.app.get<OwnRatingReads>(OWN_RATING_READS);
  const original = reads.context;
  reads.context = async () => null;
  try {
    const unlinked = await read();
    expect(unlinked.statusCode).toBe(403);
    expect(unlinked.json().code).toBe('FORBIDDEN');
    expect(unlinked.headers['cache-control']).toBe('no-store');
  } finally {
    reads.context = original;
  }
});

it('RS-08a answers from one snapshot: a column setting committed after the read began is not seen by it', async () => {
  await saveColumns(['date', 'tip']);
  const reads = f.h.app.get<OwnRatingReads>(OWN_RATING_READS);
  const original = reads.context;
  reads.context = async (tx, context, now) => {
    const live = await original(tx, context, now);
    await saveColumns(['rating_average']);
    return live;
  };
  try {
    expect((await read()).json()).toEqual({ visibility: 'HIDDEN' });
  } finally {
    reads.context = original;
    await saveColumns(null);
  }
  expect((await read()).json()).toEqual({ visibility: 'VISIBLE', average: '4.5', count: 2 });
});

it('RS-09 refuses client subjects with 403 and any other unknown key with VALIDATION_FAILED', async () => {
  for (const key of ['employee_id', 'branch_id', 'business_id', 'company_id']) {
    const response = await read(`/v1/staff/me/rating-summary?${key}=foreign`);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  }
  const unknown = await read('/v1/staff/me/rating-summary?x=1');
  expect(unknown.statusCode).toBe(400);
  expect(unknown.json().code).toBe('VALIDATION_FAILED');
  expect(unknown.headers['cache-control']).toBe('no-store');
});

it('RS-10 refuses anonymous and reception sessions on the personal route', async () => {
  for (const requestHeaders of [undefined, staffHeaders()]) {
    const response = await f.h.app.inject({
      method: 'GET',
      url: '/v1/staff/me/rating-summary',
      headers: requestHeaders ?? {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('RS-10a refuses a valid admin session on the personal route with no rating fields in the answer', async () => {
  // جلسة المالك صالحة تمامًا على مسارات admin، والمسار الشخصي بيرفضها 401 قبل أي قراءة تقييم.
  const workspace = await f.h.send('GET', '/v1/me/workspaces', { cookie: f.ownerCookie });
  expect(workspace.status).toBe(200);
  const admin = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/rating-summary',
    headers: { cookie: f.ownerCookie, origin: personalOrigin },
  });
  expect(admin.statusCode).toBe(401);
  expect(admin.json().code).toBe('UNAUTHENTICATED');
  expect(admin.json()).not.toHaveProperty('visibility');
  expect(admin.json()).not.toHaveProperty('average');
  expect(admin.json()).not.toHaveProperty('count');
  expect(admin.headers['cache-control']).toBe('no-store');
});

it('RS-11 never counts another employee or another company', async () => {
  f.setNow(new Date(Date.UTC(2026, 9, 15, 12)));
  try {
    await f.seedStars([
      { employeeId: f.employeeId, stars: 5, at: new Date(Date.UTC(2026, 9, 7, 12)) },
    ]);
    await f.seedStars([
      { employeeId: f.otherEmployeeId, stars: 2, at: new Date(Date.UTC(2026, 9, 8, 12)) },
    ]);
    await f.seedStars(
      [{ employeeId: f.otherCompanyEmployeeId, stars: 1, at: new Date(Date.UTC(2026, 9, 9, 12)) }],
      RATING_TENANT.B,
    );
    expect((await read()).json()).toEqual({ visibility: 'VISIBLE', average: '5.0', count: 1 });
  } finally {
    f.setNow(at(10));
  }
});
