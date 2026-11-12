import { packageExtensionResponse, type ExtendPackageInput } from '@pospay/contracts';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { PackageExtensionController } from '../http/package-extension.controller.ts';
import { SessionAdminGuard } from '../http/session-access.guard.ts';
import {
  ExtendPackageUseCase,
  PackageExtensionError,
  SessionError,
} from '../use-cases/extend-package/extend-package.usecase.ts';
import { createPackageExtensionTransactions } from '../persistence/package-extension.transactions.ts';
import { ids, type SessionFixture } from './session.fixture.ts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';
import {
  CURRENT_EXPIRY,
  extensionBody,
  NEXT_EXPIRY,
  packageExtensionFixture,
  seedSoldPackage,
  postExtension,
  readEntitlement,
  readExtensionAudits,
  readExtensions,
  readSlots,
  seedForeignCompanyPackage,
  seedSecondBusinessPackage,
} from './package-extension.fixture.ts';
let f: SessionFixture;
let setAt: (next: Date) => void;
beforeAll(async () => {
  const fixture = await packageExtensionFixture();
  f = fixture.f;
  setAt = fixture.setAt;
});
afterAll(async () => {
  await f?.close();
});
const freshSold = (expiresOn = CURRENT_EXPIRY) =>
  seedSoldPackage(f, { sessions: 2, expiresOn });
it('EX-01 extends only the expiry and keeps one reason-free audit, one history row and no event', async () => {
  const seeded = await freshSold();
  const beforeSlots = await readSlots(f, seeded.entitlement);
  const key = ids.newId();
  const reason = '  Customer asked for renewal  ';
  const response = await postExtension(f, seeded.entitlement, {
    key,
    body: extensionBody({ reason }),
  });
  expect(response.status).toBe(201);
  const body = packageExtensionResponse.parse(response.body);
  expect(body).toMatchObject({
    entitlement_id: seeded.entitlement,
    previous_expires_on: CURRENT_EXPIRY,
    new_expires_on: NEXT_EXPIRY,
    extended_at: '2026-10-15T08:00:00.000Z',
  });
  expect(JSON.stringify(body)).not.toContain(reason.trim());
  const history = await readExtensions(f, seeded.entitlement);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    id: body.id,
    previous_expires_on: CURRENT_EXPIRY,
    new_expires_on: NEXT_EXPIRY,
    reason: reason.trim(),
    extended_by: f.userId,
    extended_by_membership_id: f.membership,
    branch_id: f.branch,
  });
  expect(await readEntitlement(f, seeded.entitlement)).toMatchObject({
    expires_on: NEXT_EXPIRY,
    revision: 1,
    refunded_amount: '0.000',
    price_paid: '2.000',
  });
  expect(await readSlots(f, seeded.entitlement)).toEqual(beforeSlots);
  const audits = await readExtensionAudits(f, seeded.entitlement);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: 'package.extended',
    entity: 'package_entitlement',
    before: { expires_on: CURRENT_EXPIRY },
    after: { expires_on: NEXT_EXPIRY, extension_id: body.id },
  });
  expect(JSON.stringify(audits[0])).not.toContain(reason.trim());
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${seeded.entitlement}`).toHaveLength(0);
  const [stored] = await f.h.owner`SELECT response_body FROM idempotency_keys WHERE key=${key}`;
  expect(JSON.stringify(stored?.['response_body'])).not.toContain(reason.trim());
});
it('EX-02 checks staleness first, refuses invalid dates and accepts the exact two-year boundary', async () => {
  const seeded = await freshSold();
  const stale = await postExtension(f, seeded.entitlement, {
    body: extensionBody({ expected_expires_on: '2026-12-29' }),
  });
  expect(stale).toMatchObject({ status: 409, body: { code: 'PACKAGE_EXPIRY_STALE' } });
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(0);
  for (const [newExpiresOn, code] of [
    [CURRENT_EXPIRY, 'PACKAGE_EXTENSION_NOT_LATER'],
    ['2028-10-16', 'PACKAGE_EXTENSION_TOO_LONG'],
  ] as const) {
    const refused = await postExtension(f, seeded.entitlement, {
      body: extensionBody({ new_expires_on: newExpiresOn }),
    });
    expect(refused).toMatchObject({ status: 422, body: { code } });
  }
  const accepted = await postExtension(f, seeded.entitlement, {
    body: extensionBody({ new_expires_on: '2028-10-15' }),
  });
  expect(accepted.status).toBe(201);
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(1);
});
it('EX-03 refuses redemption before extension and redeems inside the new window afterwards', async () => {
  const seeded = await freshSold('2026-10-01');
  await expect(f.create.execute({
    ...f.context(ids.newId()),
    input: f.body([packageLine(f, seeded.entitlement)]),
  })).rejects.toMatchObject({ code: 'PACKAGE_EXPIRED' });
  const extended = await postExtension(f, seeded.entitlement, {
    body: extensionBody({ new_expires_on: '2026-11-30', expected_expires_on: '2026-10-01' }),
  });
  expect(extended.status).toBe(201);
  const redeemed = await f.create.execute({
    ...f.context(ids.newId()),
    input: f.body([packageLine(f, seeded.entitlement)]),
  });
  expect(redeemed.outcome).toBe('COMPLETE');
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`)
    .toHaveLength(1);
  expect((await readSlots(f, seeded.entitlement)).map((row) => row['state'])).toContain('USED');
});
it('EX-04 rejects amount and a missing key without writing anything', async () => {
  const seeded = await freshSold();
  const key = ids.newId();
  const amount = await postExtension(f, seeded.entitlement, {
    key,
    body: extensionBody({ amount: '10.000' }),
  });
  expect(amount).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
  const missing = await f.h.send('POST', `/v1/businesses/${f.business}/branches/${f.branch}/packages/${seeded.entitlement}/extensions`, {
    cookie: f.cookie,
    company: f.company,
    body: extensionBody(),
  });
  expect(missing).toMatchObject({ status: 400, body: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(0);
  expect(await f.h.owner`SELECT 1 FROM idempotency_keys WHERE key=${key}`).toHaveLength(0);
  expect((await readEntitlement(f, seeded.entitlement))?.['expires_on']).toBe(CURRENT_EXPIRY);
});
it('EX-05 refuses no permission, disabled orders and a DENY override', async () => {
  const seeded = await freshSold();
  const outsider = await f.h.signedInOperator('no-package-extension@example.test');
  expect((await postExtension(f, seeded.entitlement, { cookie: outsider })).status).toBe(403);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic extension feature',${f.ownerId})`;
  try {
    expect(await postExtension(f, seeded.entitlement)).toMatchObject({
      status: 403,
      body: { code: 'FEATURE_DISABLED' },
    });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'extend:packages:branch','DENY','BRANCH',${f.branch},
      'Synthetic extension deny',${f.ownerId})`;
  try {
    expect((await postExtension(f, seeded.entitlement)).status).toBe(403);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${deny}`;
  }
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(0);
});
it('EX-05 extends an IMPORTED entitlement and records the lowest eligible membership id', async () => {
  const imported = await seedPackage(f, { sessions: 1, expiresOn: CURRENT_EXPIRY });
  expect((await postExtension(f, imported.entitlement)).status).toBe(201);
  expect((await readEntitlement(f, imported.entitlement))?.['provenance']).toBe('IMPORTED');
  const [role] = await f.h.owner`SELECT role_id FROM memberships WHERE id=${f.membership}`;
  const extra = ids.newId();
  await f.h.owner`INSERT INTO memberships
    (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.company},${extra},${f.userId},${role?.['role_id']},'global','COMPANY',${f.company},'2026-01-01')`;
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${extra},'extend:packages:branch','ALLOW','COMPANY',${f.company},
      'Synthetic company extension grant',${f.ownerId})`;
  const other = await freshSold();
  expect((await postExtension(f, other.entitlement)).status).toBe(201);
  const history = await readExtensions(f, other.entitlement);
  expect(history[0]?.['extended_by_membership_id']).toBe([f.membership, extra].sort()[0]);
});
it('replays one response, refuses a changed body and blocks replay after permission loss', async () => {
  const seeded = await freshSold();
  const key = ids.newId();
  const body = extensionBody();
  const first = await postExtension(f, seeded.entitlement, { key, body });
  const replay = await postExtension(f, seeded.entitlement, { key, body });
  expect(first.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(1);
  expect(await readExtensionAudits(f, seeded.entitlement)).toHaveLength(1);
  expect(await postExtension(f, seeded.entitlement, {
    key,
    body: extensionBody({ new_expires_on: '2027-02-01' }),
  })).toMatchObject({ status: 422, body: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE key=${key}`;
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'extend:packages:branch','DENY','BRANCH',${f.branch},
      'Synthetic replay deny',${f.ownerId})`;
  try {
    expect((await postExtension(f, seeded.entitlement, { key, body })).status).toBe(403);
    const [again] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE key=${key}`;
    expect(again?.['body']).toBe(stored?.['body']);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${deny}`;
  }
});
it('leaves a key reusable after a 409 or 422 refusal', async () => {
  const staleSeed = await freshSold();
  const staleKey = ids.newId();
  const stale = await postExtension(f, staleSeed.entitlement, {
    key: staleKey,
    body: extensionBody({ expected_expires_on: '2026-12-29' }),
  });
  expect(stale).toMatchObject({ status: 409, body: { code: 'PACKAGE_EXPIRY_STALE' } });
  expect((await postExtension(f, staleSeed.entitlement, { key: staleKey })).status).toBe(201);
  const invalidSeed = await freshSold();
  const invalidKey = ids.newId();
  const invalid = await postExtension(f, invalidSeed.entitlement, {
    key: invalidKey,
    body: extensionBody({ new_expires_on: CURRENT_EXPIRY }),
  });
  expect(invalid).toMatchObject({ status: 422, body: { code: 'PACKAGE_EXTENSION_NOT_LATER' } });
  expect((await postExtension(f, invalidSeed.entitlement, { key: invalidKey })).status).toBe(201);
});
it('extends repeatedly and keeps ordered history', async () => {
  const seeded = await freshSold();
  await postExtension(f, seeded.entitlement);
  await postExtension(f, seeded.entitlement, {
    body: extensionBody({ expected_expires_on: NEXT_EXPIRY, new_expires_on: '2027-02-28' }),
  });
  const history = await readExtensions(f, seeded.entitlement);
  expect(history.map((row) => row['previous_expires_on'])).toEqual([CURRENT_EXPIRY, NEXT_EXPIRY]);
  expect(history.map((row) => row['new_expires_on'])).toEqual([NEXT_EXPIRY, '2027-02-28']);
});
it('returns the same 404 for unknown, foreign-company and foreign-business entitlements', async () => {
  const unknown = await postExtension(f, ids.newId());
  expect(unknown).toMatchObject({ status: 404, body: { code: 'PACKAGE_NOT_FOUND' } });
  const foreign = await seedForeignCompanyPackage(f);
  const foreignResponse = await postExtension(f, foreign.entitlement);
  expect(foreignResponse.body).toEqual(unknown.body);
  const otherBusiness = await seedSecondBusinessPackage(f);
  const businessResponse = await postExtension(f, otherBusiness.entitlement, {
    cookie: f.ownerCookie,
  });
  expect(businessResponse.body).toEqual(unknown.body);
});
it('trims reasons and enforces 1..500 code points', async () => {
  const empty = await freshSold();
  expect(await postExtension(f, empty.entitlement, {
    body: extensionBody({ reason: ' \t\r\n ' }),
  })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
  const astral = '😀'.repeat(500);
  const accepted = await freshSold();
  expect((await postExtension(f, accepted.entitlement, {
    body: extensionBody({ reason: astral }),
  })).status).toBe(201);
  expect((await readExtensions(f, accepted.entitlement))[0]?.['reason']).toBe(astral);
  const excessive = await freshSold();
  expect(await postExtension(f, excessive.entitlement, {
    body: extensionBody({ reason: '😀'.repeat(501) }),
  })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
});
it('uses each acting branch local date for the two-year cap', async () => {
  const london = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en,timezone)
    VALUES(${f.company},${london},${f.business},'London branch','Europe/London')`;
  const instant = new Date('2026-10-21T21:30:00.000Z');
  setAt(instant);
  const kuwait = await freshSold();
  expect((await postExtension(f, kuwait.entitlement, {
    cookie: f.ownerCookie,
    body: extensionBody({ new_expires_on: '2028-10-22' }),
  })).status).toBe(201);
  const londonSeed = await freshSold();
  expect(await postExtension(f, londonSeed.entitlement, {
    cookie: f.ownerCookie,
    branchId: london,
    body: extensionBody({ new_expires_on: '2028-10-22' }),
  })).toMatchObject({ status: 422, body: { code: 'PACKAGE_EXTENSION_TOO_LONG' } });
  setAt(new Date('2026-10-15T08:00:00.000Z'));
});

// جلسة الجهاز الحقيقية تحتاج Redis؛ نثبت أن الحارس نفسه يرفض أي مبدأ ليس مستخدماً.
it('EX-05 refuses a device principal through the route guard', () => {
  const context = (kind: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ principal: { kind } }) }),
  }) as unknown as ExecutionContext;
  expect(() => new SessionAdminGuard().canActivate(context('device'))).toThrow(ApiError);
  expect(new SessionAdminGuard().canActivate(context('user'))).toBe(true);
  const guards: unknown[] = Reflect.getMetadata('__guards__', PackageExtensionController.prototype.extend) ?? [];
  expect(guards).toContain(SessionAdminGuard);
});

// تعارض المعاملة المؤقت يجب أن يبقى 409 قابلاً لإعادة المحاولة بدلاً من التحول إلى 500.
it('maps TRANSACTION_RETRY_REQUIRED to the registered retryable 409', async () => {
  const controller = new PackageExtensionController({
    execute: async () => {
      throw new SessionError('TRANSACTION_RETRY_REQUIRED');
    },
  } as unknown as ExtendPackageUseCase);
  const request = {
    principal: { kind: 'user', companyId: ids.newId(), userId: ids.newId() },
    method: 'POST',
    routeOptions: {
      url: '/v1/businesses/:businessId/branches/:branchId/packages/:entitlementId/extensions',
    },
    query: {},
  } as unknown as FastifyRequest;
  const error = await controller.extend(
    ids.newId(),
    ids.newId(),
    ids.newId(),
    extensionBody(),
    { key: ids.newId(), fingerprint: 'controller-test' },
    request,
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: 'TRANSACTION_RETRY_REQUIRED', status: 409 });
});

async function directExtension(entitlementId: string, key: string, input: ExtendPackageInput) {
  const useCase = new ExtendPackageUseCase(createPackageExtensionTransactions(f.db), ids, f.clock);
  return useCase.execute({ ...f.context(key), entitlementId, input });
}

async function successfulDirectExtension() {
  const seeded = await freshSold();
  const key = ids.newId();
  const input = extensionBody() as ExtendPackageInput;
  const first = await directExtension(seeded.entitlement, key, input);
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE key=${key}`;
  return { seeded, key, input, first, stored };
}

// إعادة الإرسال بعد DENY يجب أن تُرفض من حالة الاستخدام نفسها دون تغيير الرد أو مضاعفة الآثار.
it('rechecks a direct replay after an extension DENY and preserves the stored response and rows', async () => {
  const { seeded, key, input, stored } = await successfulDirectExtension();
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'extend:packages:branch','DENY','BRANCH',${f.branch},
      'Synthetic direct replay deny',${f.ownerId})`;
  try {
    const error = await directExtension(seeded.entitlement, key, input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PackageExtensionError);
    expect(error).toMatchObject({ code: 'FORBIDDEN' });
    const [again] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE key=${key}`;
    expect(again?.['body']).toBe(stored?.['body']);
    expect(await readExtensions(f, seeded.entitlement)).toHaveLength(1);
    expect(await readExtensionAudits(f, seeded.entitlement)).toHaveLength(1);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${deny}`;
  }
});

// تعطيل orders بعد أول كتابة يجب أن يمنع الرد المخزن أيضاً وأن يبقي كل الآثار كما هي.
it('rechecks a direct replay with orders disabled and preserves the stored response and rows', async () => {
  const { seeded, key, input, stored } = await successfulDirectExtension();
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic direct replay feature',${f.ownerId})`;
  try {
    const error = await directExtension(seeded.entitlement, key, input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PackageExtensionError);
    expect(error).toMatchObject({ code: 'FEATURE_DISABLED' });
    const [again] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE key=${key}`;
    expect(again?.['body']).toBe(stored?.['body']);
    expect(await readExtensions(f, seeded.entitlement)).toHaveLength(1);
    expect(await readExtensionAudits(f, seeded.entitlement)).toHaveLength(1);
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

// بقاء السلطة يجب أن يعيد الجسم نفسه من حالة الاستخدام دون أي صف تمديد أو تدقيق إضافي.
it('returns the identical direct replay with access intact and writes nothing more', async () => {
  const { seeded, key, input, first, stored } = await successfulDirectExtension();
  expect(await directExtension(seeded.entitlement, key, input)).toEqual(first);
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(1);
  expect(await readExtensionAudits(f, seeded.entitlement)).toHaveLength(1);
  const [again] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE key=${key}`;
  expect(again?.['body']).toBe(stored?.['body']);
});
