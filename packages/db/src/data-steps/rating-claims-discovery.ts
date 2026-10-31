import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { Database } from '../client.ts';
import { appendOutboxEvent } from '../outbox.ts';
import type { Tx } from '../with-tenant.ts';

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: لا يحمل اسم شركة ولا معرّف طلب.
 * بدون التجاوز، قراءة الشركات تحت FORCE RLS ترجع صفر صفوف، والخطوة كانت هتعدّي من غير ما تكتشف شركة.
 */
export class RatingClaimsDiscoveryRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step rating-claims-discovery needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/** عدّادات خطوة الاكتشاف: الشركات المقروءة والشركات اللي اتبعت لها رسالة اكتشاف. */
export interface RatingClaimsDiscoveryCounts {
  readonly companies: number;
  readonly discovered: number;
}

/**
 * يكشف الشركات عندها طلبات تقييم مجدولة لم تُطالب بها، ويبعت لكل واحدة رسالة اكتشاف واحدة.
 * مالك الترحيل يقرأ معرّفات الشركات فقط، وكل قراءة وكتابة تجري تحت withTenant على pospay_app،
 * فما فيش دور جديد ولا BYPASSRLS ولا اسم شركة في السجل (ADR-0038، D-B4).
 *
 * @param owner اتصال الترحيل لاكتشاف معرّفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @returns عدد الشركات المقروءة والشركات اللي اتبعت لها رسالة
 */
export async function discoverRatingClaims(
  owner: postgres.Sql,
  app: Database,
): Promise<RatingClaimsDiscoveryCounts> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new RatingClaimsDiscoveryRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  let discovered = 0;
  for (const { id: companyId } of companies) {
    const emitted = await app.withTenant(companyId, (tx) =>
      discoverOneCompany(tx, companyId),
    );
    if (emitted) discovered += 1;
  }
  return { companies: companies.length, discovered };
}

/**
 * رسالة اكتشاف الشركة: صف واحد في الـ outbox لما الشركة لسه عندها طلب مستني المطالبة،
 * ولا حاجة خالص لما مفيش.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @returns هل اتبعتت رسالة اكتشاف
 */
async function discoverOneCompany(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM rating_requests
     WHERE company_id = ${companyId} AND status = 'SCHEDULED'
     ORDER BY due_at, id
     LIMIT 1`);
  if (rows.length === 0) return false;
  await appendOutboxEvent(tx, systemUuidV7(), {
    aggregateType: 'company',
    aggregateId: companyId,
    eventType: 'RatingClaimsDiscoveryRequested',
    payload: { company_id: companyId },
  });
  return true;
}
