import { commissionBlockedCorrectionList } from '@pospay/contracts';
import {
  lockStatementPeriods,
  SYSTEM_ROLES,
  type TenantOptions,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  closeCommissionFixture,
  commissionPlanVersionsFixture,
  ids,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

/** اسم الجدول اللي بتقرأه جملة القائمة بس: هو العلامة اللي بتعرف بيها لحظة التوقّف من غير ما نعدّ الاستعلامات. */
const LIST_TABLE = 'commission_blocked_corrections';

/** جملة بتقرأ من السيرفر نفسه وضع المعاملة، مش من اللي المتصل طلبه. */
const MODE_STATEMENT = sql`SELECT current_setting('transaction_read_only') AS "readOnly",
  current_setting('transaction_isolation') AS "isolation"`;

/** بوابة التوقّف: بتوقّف الطلب في نص معاملته لحد ما المشهد المتزامن يخلص. */
interface Gate {
  /** بيتحلّ لما الطلب يوصل لنقطة التوقّف جوّه معاملته. */
  readonly reached: Promise<void>;
  /** بيتحلّ لما المشهد المتزامن يخلص والطلب يكمل. */
  readonly proceed: Promise<void>;
  open(): void;
  release(): void;
}

function createGate(): Gate {
  let open!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, proceed, open: () => open(), release: () => release() };
}

let gate: Gate | null = null;
let snapshotModes: { readonly readOnly: string; readonly isolation: string }[] = [];

/** نص جملة drizzle: عشان نعرف جملة القائمة بالظبط من غير ما نعدّ الاستعلامات. */
function statementText(query: unknown): string {
  if (typeof query !== 'object' || query === null || !('queryChunks' in query)) return '';
  const chunks = (query as { queryChunks: readonly unknown[] }).queryChunks;
  return chunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null || !('value' in chunk)) return '';
      const value = (chunk as { value: unknown }).value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join('');
}

/** يوقف الطلب قبل جملة القائمة، يعني بعد ما إعادة فحص الصلاحية والميزة خلصت. */
async function pauseBeforeList(query: unknown): Promise<void> {
  const current = gate;
  if (current === null) return;
  if (!statementText(query).includes(LIST_TABLE)) return;
  gate = null;
  current.open();
  await current.proceed;
}

/** غلاف قاعدة التطبيق: بيوقّف جملة القائمة مرة واحدة، وبيقرأ من السيرفر وضع معاملة القائمة. */
const wrapDatabase = (database: TenantWrappers): TenantWrappers => ({
  ...database,
  withTenant: <T>(
    companyId: string,
    work: (tx: Tx) => Promise<T>,
    options?: TenantOptions,
  ): Promise<T> =>
    database.withTenant(
      companyId,
      (tx) =>
        work(
          new Proxy(tx, {
            get: (target, property) =>
              property === 'execute'
                ? async (query: SQL) => {
                    await readSnapshotMode(target, query);
                    await pauseBeforeList(query);
                    return target.execute(query);
                  }
                : Reflect.get(target, property),
          }),
        ),
      options,
    ),
});

/** يقرأ وضع المعاملة من السيرفر عند أول جملة قائمة: الدليل إن اللقطة مطبّقة فعلاً. */
async function readSnapshotMode(tx: Tx, query: unknown): Promise<void> {
  if (snapshotModes.length > 0) return;
  if (!statementText(query).includes(LIST_TABLE)) return;
  const [row] = await tx.execute<{ readOnly: string; isolation: string }>(MODE_STATEMENT);
  snapshotModes.push({ readOnly: row?.readOnly ?? '', isolation: row?.isolation ?? '' });
}

let fx: CommissionPlanFixture;
beforeEach(async () => {
  gate = null;
  snapshotModes = [];
  fx = await commissionPlanVersionsFixture(undefined, wrapDatabase);
});
afterEach(async () => {
  gate = null;
  await closeCommissionFixture(fx);
});

const listPath = (): string => `/v1/businesses/${fx.business}/commission-blocked-corrections`;

/** بيقفل كشف هدف حقيقي لشهر معيّن، عشان FK الهدف المركّب يتكتب على كشف موجود. */
async function statementFor(period: string): Promise<string> {
  let statementId = '';
  await fx.db.withTenant(fx.company, async (tx) => {
    const [locked] = await lockStatementPeriods(tx, {
      businessId: fx.business,
      periods: [period],
      ids,
    });
    if (locked === undefined) throw new Error('the target statement row is missing after its lock');
    statementId = locked.statementId;
  });
  return statementId;
}

/** بيكتب صف تصحيح موقوف كصف حقيقي محفوظ، مع تحكم كامل في الشهر المصدر ووقت الحفظ. */
async function seedBlocked(
  statementId: string,
  sourcePeriod: string,
  createdAt: string,
): Promise<string> {
  const id = ids.newId();
  await fx.h.owner`INSERT INTO commission_blocked_corrections(
    company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
    target_statement_id,created_at)
    VALUES (${fx.company},${id},${fx.business},${fx.employee},${sourcePeriod},'NO_PLAN',
      ${ids.newId()},'2026-11',${statementId},${createdAt}::text::timestamptz)`;
  return id;
}

/** عضو بشري بصلاحية خطط العمولة، مش مالك: عشان سحب صلاحيته بـ DENY يشتغل وعضوية المالك ما تتأثرش. */
async function accountantMember(): Promise<{ cookie: string; membershipId: string }> {
  const email = 'snapshot-accountant@example.test';
  const cookie = await fx.h.signedInOperator(email);
  const [user] = await fx.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = user?.['id'] as string;
  const role = SYSTEM_ROLES.find((entry) => entry.code === 'accountant')?.id as string;
  const membershipId = ids.newId();
  await fx.h.owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES (${fx.company},${membershipId},${userId},${role},'global','BUSINESS',${fx.business},'2026-01-01')`;
  return { cookie, membershipId };
}

/** ينتظر وصول الطلب لنقطة التوقّف، ويفشل لو الطلب خلص قبلها. */
async function reachPause(current: Gate, pending: Promise<unknown>): Promise<void> {
  await Promise.race([
    current.reached,
    pending.then(() => {
      throw new Error('the request answered before it reached the pause');
    }),
  ]);
}

it('the list reads one read-only snapshot, so a mid-flight revocation does not split the page', async () => {
  const statementId = await statementFor('2026-11');
  const before = await seedBlocked(statementId, '2026-08', '2026-11-01T08:00:00Z');
  const reader = await accountantMember();
  const current = createGate();
  gate = current;
  const pending = fx.h.send('GET', listPath(), { cookie: reader.cookie, company: fx.company });
  await reachPause(current, pending);
  // التغيير المتزامن بعد إعادة الفحص: صلاحية القارئ بتتسحب، وصف تصحيح موقوف جديد بيتكتب.
  await fx.h.owner`INSERT INTO permission_overrides(
    company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${fx.company},${ids.newId()},${reader.membershipId},'manage:commission-plans:business',
      'DENY','BUSINESS',${fx.business},'Synthetic revoked grant',${fx.userId})`;
  const after = await seedBlocked(statementId, '2026-09', '2026-11-02T08:00:00Z');
  current.release();
  const response = await pending;
  expect(response.status).toBe(200);
  const body = commissionBlockedCorrectionList.parse(response.body);
  expect(body.items.map((item) => item.id)).toEqual([before]);
  expect(body.items.map((item) => item.id)).not.toContain(after);
  // الطلب الجاي بياخد لقطة جديدة، فالصلاحية المسحوبة بترفضه زي أي طلب تاني.
  const next = await fx.h.send('GET', listPath(), { cookie: reader.cookie, company: fx.company });
  expect([next.status, next.body['code']]).toEqual([403, 'FORBIDDEN']);
});

it('a feature turned off mid-flight keeps the in-flight page, and the next request is FEATURE_DISABLED', async () => {
  const statementId = await statementFor('2026-11');
  const before = await seedBlocked(statementId, '2026-08', '2026-11-01T08:00:00Z');
  const current = createGate();
  gate = current;
  const pending = fx.h.send('GET', listPath(), { cookie: fx.cookie, company: fx.company });
  await reachPause(current, pending);
  await fx.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${fx.company},'commissions',false,'Synthetic disabled',${fx.userId})`;
  const after = await seedBlocked(statementId, '2026-09', '2026-11-02T08:00:00Z');
  current.release();
  const response = await pending;
  expect(response.status).toBe(200);
  const body = commissionBlockedCorrectionList.parse(response.body);
  expect(body.items.map((item) => item.id)).toEqual([before]);
  expect(body.items.map((item) => item.id)).not.toContain(after);
  const next = await fx.h.send('GET', listPath(), { cookie: fx.cookie, company: fx.company });
  expect([next.status, next.body['code']]).toEqual([403, 'FEATURE_DISABLED']);
});

it('the list transaction runs on the server as a read-only repeatable-read snapshot', async () => {
  const statementId = await statementFor('2026-11');
  await seedBlocked(statementId, '2026-08', '2026-11-01T08:00:00Z');
  const response = await fx.h.send('GET', listPath(), { cookie: fx.cookie, company: fx.company });
  expect(response.status).toBe(200);
  expect(snapshotModes).toEqual([{ readOnly: 'on', isolation: 'repeatable read' }]);
});
