// أدوات اختبار السور: أسوار من اللقطات، وصفوف الشركة التانية، والتحقق من رفض
// كل أمر بسور قديم. الأدوات هنا مش assertions؛ الـ spec هو اللي بيقرا النتائج.
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';

import { FORWARD_VISITS } from '../../modules/customers/domain/rating-claim-scheduling.ts';
import type {
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
  RatingClaimState,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
import { type RatingClaimsWorld } from './rating-claims-world.fixture.ts';

/** سور من لقطة الحالة، عشان نختبر التعديلات على مستوى الحالة نفسها. */
export function fenceOf(
  result: ClaimStateResult<ClaimStateSnapshot>,
  ownerToken: string,
): ClaimStateFence {
  const snapshot = result.value;
  if (snapshot === undefined) throw new Error('RATING_CLAIM_STATE_SNAPSHOT_MISSING');
  return {
    companyId: snapshot.companyId,
    incarnation: snapshot.incarnation,
    expectedVersion: result.version,
    ownerToken,
  };
}

/** مفتاح حالة شركة في Redis. */
export function stateKey(prefix: string, companyId: string): string {
  return `${prefix}:rating-claims:v1:{${companyId}}:state`;
}

/** صفوف الشركة التانية: نفس معرّف الطلب في الشركة الأولى، ومعاهم طلب تاني بره الأول. */
export async function seedCompanyBRows(w: RatingClaimsWorld, shared: string): Promise<string> {
  const owner = w.base.owner;
  const bCustomer = w.base.ids.newId();
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${w.otherCompany}, ${bCustomer}, 'Company B customer', '+999999899999', 'en', now(), now())`;
  // عميل تاني للشركة التانية، لأن يوم الطلب مفروض يبقى فريد مع العميل.
  const bSecondCustomer = w.base.ids.newId();
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${w.otherCompany}, ${bSecondCustomer}, 'Company B second customer', '+999999899998', 'en', now(), now())`;
  await owner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
    VALUES (${w.otherCompany}, ${shared}, ${w.otherBusiness}, ${bCustomer}, '2026-06-01',
      ${'01920000-0000-7000-8000-0000000000b2'}, '2026-06-01T13:10:00.000Z', '2026-06-01T19:30:00.000Z', 'SCHEDULED')`;
  const bOnly = w.base.ids.newId();
  await owner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
    VALUES (${w.otherCompany}, ${bOnly}, ${w.otherBusiness}, ${bSecondCustomer}, '2026-06-01',
      ${'01920000-0000-7000-8000-0000000000b2'}, '2026-06-01T13:10:00.000Z', '2026-06-01T19:30:00.000Z', 'SCHEDULED')`;
  return bOnly;
}

/** عزل المستأجر: دور الشركة الأولى ما بيقرش ولا بيكتبش صف الشركة التانية. */
export async function expectTenantIsolation(w: RatingClaimsWorld, bOnly: string): Promise<void> {
  // دور صاحب القاعدة بيشوف صف الشركة التانية، فالعزل من الـ RLS مش من الاستعلام.
  const ownerSeen = await w.base.owner`SELECT id FROM rating_requests
    WHERE company_id = ${w.otherCompany}`;
  expect(ownerSeen).toHaveLength(2);
  // المستأجر الأول ما بيقرش الصف التاني حتى بالمعرّف: الاستعلام من غير أي فلتر
  // على الشركة، فاللي خفاه هو الـ RLS نفسه.
  const seenByA = await w.base.db.withTenant(w.company, async (tx) => {
    const rows = await tx.execute(sql`SELECT id FROM rating_requests WHERE id = ${bOnly}`);
    return rows.length;
  });
  expect(seenByA).toBe(0);
  // ولا بيكتبش فيه: الصف مخفي، فالتحديث ما بيلمسش أي صف.
  const writtenByA = await w.base.db.withTenant(w.company, async (tx) => {
    const rows = await tx.execute(sql`UPDATE rating_requests SET status = 'CANCELLED'
      WHERE id = ${bOnly} RETURNING id`);
    return rows.length;
  });
  expect(writtenByA).toBe(0);
  // والدور بتاع المستأجر نفسه ما عندوش BYPASSRLS.
  const bypass = await w.base.db.withTenant(w.company, async (tx) => {
    const rows = await tx.execute(sql`SELECT rolbypassrls AS bypass FROM pg_roles
      WHERE rolname = current_user`);
    return rows[0]?.['bypass'];
  });
  expect(bypass).toBe(false);
}

/**
 * يسجّل صفحة فيها طلب واحد، ويسوّيه بالتسوية retry، ثم يحجز تذكرة إعادة له.
 *
 * الخطوات كلها بتستخدم نفس المعرّفات: نفس معرّف الصفحة، ونفس رمز الشغل، ونفس
 * الطلب، ونفس رمز التذكرة. كده السور القديم لو رفض، يكون الرفض من السور نفسه.
 *
 * @param w عالم القبول
 * @param fence سور المالك الحالي
 * @param sweepId معرّف الجولة
 * @param pageId معرّف الصفحة
 * @param requestId الطلب في الصفحة
 * @param workToken رمز شغل بند الصفحة
 * @param reservationToken رمز تذكرة الإعادة
 * @returns السور بعد آخر أمر، برقم النسخة الحالي
 */
export async function enrollAndReserve(
  w: RatingClaimsWorld,
  fence: ClaimStateFence,
  sweepId: string,
  pageId: string,
  requestId: string,
  workToken: string,
  reservationToken: string,
): Promise<ClaimStateFence> {
  const begun = await w.state.port.begin(fence, sweepId, requestId);
  expect(begun.code).toBe('OK');
  const afterBegin = { ...fence, expectedVersion: begun.version };
  const enrolled = await w.state.port.enrollPage(
    afterBegin,
    sweepId,
    null,
    pageId,
    [{ requestId, workToken }],
    true,
    FORWARD_VISITS,
  );
  expect(enrolled.code).toBe('OK');
  const afterEnroll = { ...afterBegin, expectedVersion: enrolled.version };
  const settled = await w.state.port.settlePage(afterEnroll, pageId, workToken, 'RETRY');
  expect(settled.code).toBe('OK');
  const afterSettle = { ...afterEnroll, expectedVersion: settled.version };
  const reserved = await w.state.port.reserveRetries(afterSettle, 1, [reservationToken]);
  expect(reserved.code).toBe('OK');
  return { ...afterSettle, expectedVersion: reserved.version };
}

/**
 * كل أمر بالسور القديم لازم يترفض، حتى لو رقم النسخة هو رقم الحالة الحالية.
 *
 * @param state منفذ الحالة
 * @param fence السور القديم
 * @param pageId معرّف الصفحة الموجودة في الحالة
 * @param pageWorkToken رمز شغل بند الصفحة
 * @param requestId الطلب المحجوز في خريطة الإعادة
 * @param retryWorkToken رمز تذكرة الإعادة المحجوزة
 */
export async function expectEveryCommandStale(
  state: RatingClaimState,
  fence: ClaimStateFence,
  pageId: string,
  pageWorkToken: string,
  requestId: string,
  retryWorkToken: string,
): Promise<void> {
  expect((await state.settlePage(fence, pageId, pageWorkToken, 'RETRY')).code).toBe('STALE');
  expect((await state.settleRetry(fence, requestId, retryWorkToken, 'RETRY')).code).toBe('STALE');
  expect((await state.renew(fence)).code).toBe('STALE');
  expect((await state.release(fence)).code).toBe('STALE');
}
