import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { Database } from '../client.ts';
import { appendOutboxEvent } from '../outbox.ts';
import type { Tx } from '../with-tenant.ts';
import type { OutboxDispatcherDatabase } from '../dispatcher.ts';

/** رفض دور ترحيل لا يملك تعداد الشركات؛ الرسالة ثابتة ولا تحمل بيانات إعدادات. */
export class RatingDiscoveryRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super('RATING_CLAIMS_DISCOVERY_MIGRATION_ROLE_REFUSED');
  }
}

/** عدادات إجمالية فقط؛ الحالات السابقة لا تُعدّل ولا يُعاد إرسالها. */
export interface RatingDiscoveryCounts {
  companies: number;
  scheduled: number;
  sending: number;
  sent: number;
  historicalAttempts: number;
  discoveryEvents: number;
}

/**
 * يجهز اكتشاف الطلبات السابقة دون مطالبتها أو تغيير محاولات الإرسال.
 * مالك الترحيل يقرأ معرفات الشركات فقط؛ كل قراءة أو كتابة شركة تحت withTenant.
 * الحدث مستقل وفق PP-96، والإعادة تجد الحدث نفسه حتى لو نُشر أو توقف.
 *
 * @param owner اتصال الترحيل المحمي بقفل الـ migration
 * @param app واجهة pospay_app المقيدة
 * @param reader قارئ المرسل المقيد؛ لا يمنح التطبيق قراءة outbox
 * @returns عدادات للتسجيل بلا هواتف أو معرفات أو روابط
 */
export async function discoverRatingClaims(
  owner: postgres.Sql,
  app: Pick<Database, 'withTenant'>,
  reader: Pick<OutboxDispatcherDatabase, 'ratingClaimsDiscoveryExists'>,
): Promise<RatingDiscoveryCounts> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new RatingDiscoveryRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  const counts: RatingDiscoveryCounts = {
    companies: companies.length,
    scheduled: 0,
    sending: 0,
    sent: 0,
    historicalAttempts: 0,
    discoveryEvents: 0,
  };
  const ids = systemUuidV7();
  for (const { id: companyId } of companies) {
    const company = await app.withTenant(companyId, async (tx) => {
      // يحمي حتى بعد فقد قفل owner؛ قارئ dispatcher لا يستطيع مشاركة اتصال التطبيق INSERT-only.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        app_company_id()::text || ':rating_claims_discovery:' || ${companyId}::uuid::text, 0))`);
      const discovered = await reader.ratingClaimsDiscoveryExists(companyId);
      const inventory = await ratingInventory(tx, companyId);
      if (inventory.scheduled === 0 || discovered) return { ...inventory, discoveryEvents: 0 };
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'rating_claims_discovery',
        aggregateId: companyId,
        eventType: 'RatingClaimsDiscoveryRequested',
        payload: {},
      });
      return { ...inventory, discoveryEvents: 1 };
    });
    counts.scheduled += company.scheduled;
    counts.sending += company.sending;
    counts.sent += company.sent;
    counts.historicalAttempts += company.historicalAttempts;
    counts.discoveryEvents += company.discoveryEvents;
  }
  return counts;
}

// سجل migrate يحدد هل نحتاج إجابة المالك عن الحالات التاريخية؛ لا تُقرأ أي حمولة أو بيانات عميل.
async function ratingInventory(tx: Tx, companyId: string) {
  const [requests] = await tx.execute<{ scheduled: number; sending: number; sent: number }>(sql`
    SELECT count(*) FILTER (WHERE status='SCHEDULED')::int AS scheduled,
      count(*) FILTER (WHERE status='SENDING')::int AS sending,
      count(*) FILTER (WHERE status='SENT')::int AS sent
    FROM rating_requests WHERE company_id=${companyId}`);
  const [attempts] = await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count
    FROM notification_attempts WHERE company_id=${companyId} AND template_key='rating_request'
      AND status IN ('SENDING','SENT','FAILED','EXPIRED','SUPPRESSED')`);
  return {
    scheduled: requests?.scheduled ?? 0,
    sending: requests?.sending ?? 0,
    sent: requests?.sent ?? 0,
    historicalAttempts: attempts?.count ?? 0,
  };
}
