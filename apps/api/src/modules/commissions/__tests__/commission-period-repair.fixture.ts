import { createCommissionCorrectionScope } from '@pospay/commissions-posting';
import { lockStatementPeriods } from '@pospay/db';

import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  insertCommissionAttachment,
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  COMMISSION_NOW,
  commissionPlanVersionsFixture,
  ids,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

export type RepairFixture = Awaited<ReturnType<typeof repairFixture>>;

export const NO_PLAN_REPAIR = {
  base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
  tiers: { enabled: false },
  package_sale: { enabled: false },
} as const;

/** خطة أساسي بنسبة وتاريخ سريان، من غير شرائح، زي V1 في أمثلة plan-55-2.md §7. */
export const flatPlan = (bps: number) => ({
  base: { enabled: true, calc: { kind: 'PCT', bps } },
  tiers: { enabled: false },
  package_sale: { enabled: false },
});

/** شرائح هامشية على المبلغ بحد 400.000 تدفع 10% (V1 في المثال O2). */
export const tieredPlan = {
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'AMOUNT', value: '400.000' }, calc: { kind: 'PCT', bps: 1000 } }],
  },
  package_sale: { enabled: false },
} as const;

/** شرائح بحد مضاعف راتب 1.00 تدفع 10%، بلا أساسي: بتحتاج راتباً (V2 في المثال O4). */
export const salaryPlan = {
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: '1.00' }, calc: { kind: 'PCT', bps: 1000 } }],
  },
  package_sale: { enabled: false },
} as const;

export interface SeededLine {
  readonly id: string;
  readonly date: string;
  readonly net: string;
}

export interface FrozenSeed {
  readonly id: string;
  readonly date: string;
  readonly amount: string;
}

export interface BlockedSeptember {
  readonly blockId: string;
  readonly firstEventId: string;
  readonly targetStatementId: string;
}

/** نفس تركيبة اختبارات الخطط، مع خدمة وعميلة عشان بنود الإسقاط تتدرج. */
export async function repairFixture(clock?: () => Date) {
  const f = await commissionPlanVersionsFixture(clock);
  const service = ids.newId();
  const customer = ids.newId();
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${f.company},${service},${f.business},'Repair service',1.000,'ZERO')`;
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES (${f.company},${customer},'Repair customer','+96500000099','ar',now(),now())`;
  const [membership] = await f.h.owner`SELECT id FROM memberships
    WHERE company_id=${f.company} AND user_id=${f.userId} LIMIT 1`;
  return {
    ...f,
    service,
    customer,
    tenant: { ...f.tenant, membership: membership?.['id'] as string, service, customer },
    path: (employeeId = f.employee, business = f.business) =>
      `/v1/businesses/${business}/employees/${employeeId}/commission-period-repairs`,
    repair: (body: object, key: string, employeeId = f.employee, actor = f.cookie) =>
      f.h.send(
        'POST',
        `/v1/businesses/${f.business}/employees/${employeeId}/commission-period-repairs`,
        { cookie: actor, company: f.company, key, body },
      ),
  };
}

/**
 * يزرع سبتمبر معتمداً بصفوف مجمّدة، وخطة من تاريخ معين، وبنود الإسقاط الحالية، وتصحيحاً موقوفاً مفتوحاً
 * لشهر سبتمبر بكود معين، ويسيب أكتوبر DRAFT كهدف. الأرقام كلها من خطط plan-55-2.md §7 بإيد، مش من ناتج الكود.
 */
interface BlockedSeptemberSeed {
  readonly plan: object;
  readonly planFrom: string;
  readonly lines: readonly SeededLine[];
  readonly frozen: readonly FrozenSeed[];
  readonly code?: 'NO_PLAN' | 'NO_SALARY';
}

async function seedProjection(r: RepairFixture, seed: BlockedSeptemberSeed): Promise<void> {
  await r.db.withTenant(r.company, async (tx) => {
    await insertCommissionPlanVersion(tx, r.tenant, ids, {
      effectiveFrom: seed.planFrom,
      plan: seed.plan,
      createdBy: r.userId,
    });
    for (const [index, line] of seed.lines.entries()) {
      await insertCommissionLineProjection(tx, r.tenant, ids, {
        lineId: line.id,
        businessDate: line.date,
        occurredAt: `${line.date}T09:00:00Z`,
        recordedAt: `${line.date}T09:00:00Z`,
        period: '2026-09',
        net: line.net,
        ruleKind: 'FOLLOW_PLAN',
        sessionId: ids.newId(),
        revision: index + 1,
      });
    }
  });
}

async function approveSeptember(r: RepairFixture, frozen: readonly FrozenSeed[]): Promise<void> {
  await walkCommissionStatement(r.db, {
    tenant: r.tenant,
    reviewer: r.userId,
    period: '2026-09',
    ids,
    to: 'APPROVED',
    afterApproved: async (tx, statementId) => {
      for (const row of frozen) {
        await insertCommissionLine(tx, r.tenant, statementId, ids, {
          kind: 'COMMISSION',
          lineId: row.id,
          sourceRef: `line:${row.id}`,
          amount: row.amount,
          sourceBranchId: r.branch,
          attachedBranchIds: [r.branch],
          sourceBusinessDate: row.date,
        });
      }
      await insertCommissionAttachment(tx, r.tenant, statementId, ids, {});
    },
  });
}

/**
 * يزرع سبتمبر معتمداً بصفوف مجمّدة، وخطة من تاريخ معين، وبنود الإسقاط الحالية، وتصحيحاً موقوفاً مفتوحاً
 * لشهر سبتمبر بكود معين، ويسيب أكتوبر DRAFT كهدف. الأرقام كلها من خطط plan-55-2.md §7 بإيد، مش من ناتج الكود.
 */
export async function seedBlockedSeptember(
  r: RepairFixture,
  seed: BlockedSeptemberSeed,
): Promise<BlockedSeptember> {
  await seedProjection(r, seed);
  await approveSeptember(r, seed.frozen);
  const firstEventId = ids.newId();
  return r.db.withTenant(r.company, async (tx) => {
    const [october] = await lockStatementPeriods(tx, {
      businessId: r.business,
      periods: ['2026-10'],
      ids,
    });
    if (october === undefined) throw new Error('October was not locked');
    const blockId = await createCommissionCorrectionScope(tx, ids, {
      now: () => COMMISSION_NOW,
    }).insertBlock({
      businessId: r.business,
      employeeId: r.employee,
      sourcePeriod: '2026-09',
      code: seed.code ?? 'NO_PLAN',
      firstEventId,
      targetPeriod: '2026-10',
      targetStatementId: october.statementId,
    });
    return { blockId, firstEventId, targetStatementId: october.statementId };
  });
}

export const correctionRows = (r: CommissionPlanFixture) => r.h.owner`
  SELECT source_ref, amount::text AS amount, previous_amount::text AS previous_amount,
    new_amount::text AS new_amount, event_id::text AS event_id, target_period,
    target_statement_id::text AS target_statement_id, source_period
  FROM commission_corrections ORDER BY source_ref`;

export const blockRows = (r: CommissionPlanFixture) => r.h.owner`
  SELECT id::text AS id, code, resolved_at IS NOT NULL AS resolved, first_event_id::text AS first_event_id
  FROM commission_blocked_corrections ORDER BY created_at, id`;

export const repairWrites = async (r: CommissionPlanFixture) => {
  const [versions] = await r.h.owner`SELECT count(*)::int AS count FROM commission_plan_versions
    WHERE repair_period IS NOT NULL`;
  const [audits] = await r.h.owner`SELECT count(*)::int AS count FROM audit_log
    WHERE action='commission_plan.period_repaired'`;
  const [corrections] = await r.h.owner`SELECT count(*)::int AS count FROM commission_corrections`;
  const [generations] = await r.h
    .owner`SELECT count(*)::int AS count FROM commission_period_generations`;
  return [versions, audits, corrections, generations].map((row) => row?.['count'] as number);
};
