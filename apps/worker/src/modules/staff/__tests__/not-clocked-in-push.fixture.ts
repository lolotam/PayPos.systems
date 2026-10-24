import { createECDH, createHash, randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import {
  ROLE,
  notClockedInFixture,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';

export type { NotClockedInFixture, Tenant };

/** مفتاح VAPID وهمي: 16 حرف هكس، زي اللي بيتخزن مع كل اشتراك. */
const KEY_ID = '0123456789abcdef';

/** نقطة الدفع الوهمية؛ كل اشتراك ليه تجزئة وجهة مختلفة فتبقى حية كلها. */
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/synthetic';

/** مفاتيح حقيقية: نقطة P-256 على المنحنى و16 بايت. */
const P256DH = (() => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh.getPublicKey().toString('base64url');
})();
const AUTH = randomBytes(16).toString('base64url');

/** فكسشر إشعار عدم الحضور مع اشتراكات الدفع: لغة الاشتراك ومحاولات الدفع. */
export interface NotClockedInPushFixture extends NotClockedInFixture {
  /** يسجّل اشتراك دفع حيّ للمستخدم بلغة، ويرجّع معرّف الاشتراك. */
  subscribe(company: string, userId: string, locale: 'ar' | 'en'): Promise<string>;
  /** محاولات الدفع المسجلة للشركة. */
  pushAttempts(company: string): Promise<postgres.RowList<postgres.Row[]>>;
  /** أحداث إذن إرسال الدفع: كل محاولة لها واحد. */
  pushAuthorizations(company: string): Promise<postgres.RowList<postgres.Row[]>>;
  /** صفوف الجرس داخل التطبيق للشركة. */
  inAppRows(company: string): Promise<postgres.RowList<postgres.Row[]>>;
}

/** فكسشر إشعار عدم الحضور مع اشتراكات الدفع: لغة الاشتراك ومحاولات الدفع. */
export async function notClockedInPushFixture(): Promise<NotClockedInPushFixture> {
  const base = await notClockedInFixture();
  return {
    ...base,
    subscribe: async (company, userId, locale) => {
      const id = base.ids.newId();
      await base.db.withTenant(company, (tx) =>
        tx.execute(liveSubscription(company, id, userId, locale, base.ids.newId())),
      );
      return id;
    },
    pushAttempts: (company) =>
      base.owner`SELECT id, user_id, template_key, template_revision, locale, status, send_deadline,
          safe_parameters FROM push_attempts WHERE company_id=${company} ORDER BY id`,
    pushAuthorizations: (company) =>
      base.owner`SELECT payload FROM outbox
        WHERE company_id=${company} AND event_type='PushSendAuthorized' ORDER BY seq`,
    inAppRows: (company) =>
      base.owner`SELECT recipient_user_id, template_key FROM in_app_notifications
        WHERE company_id=${company} ORDER BY recipient_user_id`,
  };
}

/** مديرون وهميون بفرع الوردية: عضويات بدور مدير الفرع، فكلهم من مستلمي جرس المديرين. */
export async function seedManagers(
  f: NotClockedInFixture,
  tenant: Tenant,
  count: number,
): Promise<string[]> {
  await f.owner`WITH seeded AS (
    INSERT INTO "user"(id, name, email)
    SELECT gen_random_uuid(), 'Synthetic manager', gen_random_uuid()::text || '@example.test'
    FROM generate_series(1, ${count}::int) RETURNING id
  )
  INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
  SELECT ${tenant.company}, gen_random_uuid(), seeded.id, ${ROLE.branch_manager}, 'global', 'BRANCH', ${tenant.branch}, '2026-01-01T00:00:00Z'
  FROM seeded`;
  const rows = await f.owner`SELECT user_id FROM memberships
    WHERE company_id=${tenant.company} AND role_id=${ROLE.branch_manager} ORDER BY user_id`;
  return rows.map((row) => String(row['user_id']));
}

const digest = (label: string) => createHash('sha256').update(label).digest();

const liveSubscription = (
  company: string,
  id: string,
  userId: string,
  locale: 'ar' | 'en',
  deliveryToken: string,
) => sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
    endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at)
  VALUES(${company},${id},${userId},${digest(`install:${id}`)},${ENDPOINT},${P256DH},${AUTH},
    ${digest(`endpoint:${id}`)},${deliveryToken},1,${locale},${KEY_ID},now(),now(),now())`;
