import type {
  CommissionServiceOverride,
  CreateCommissionServiceOverrideInput,
} from '@pospay/contracts';
import { computePeriod, type CommissionPeriodInput } from '@pospay/commissions-engine';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { closeCommissionFixture, ids } from '../__tests__/commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  idempotencyClaims,
  overrideAndAuditCounts,
  overrideInput,
  runOverride,
  savedOverrideRows,
  writeOverride,
  type CommissionServiceOverrideFixture,
} from '../__tests__/commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeAll(async () => {
  f = await commissionServiceOverridesFixture();
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

type SavedOverrideRow = {
  readonly employee_id: string;
  readonly service_id: string;
  readonly rule_kind: string;
  readonly rule_pct_bps: number | null;
  readonly rule_fixed_amount: string | null;
  readonly effective_from: string;
  readonly created_at_micros: string;
};

/** الصف المحفوظ في الداتابيز نفسه، لأن السطر المحفوظ هو المرجع مش جسم الطلب. */
async function savedRow(id: string): Promise<SavedOverrideRow> {
  const [row] = await f.h.owner<SavedOverrideRow[]>`
    SELECT employee_id,service_id,rule_kind,rule_pct_bps,
      rule_fixed_amount::text AS rule_fixed_amount,
      to_char(effective_from,'YYYY-MM-DD') AS effective_from,
      (extract(epoch from created_at)*1000000)::bigint::text AS created_at_micros
    FROM commission_service_overrides WHERE id=${id}`;
  if (row === undefined) throw new Error(`The saved override ${id} is missing`);
  return row;
}

function savedBps(row: SavedOverrideRow): bigint {
  if (row.rule_pct_bps === null) throw new Error('The saved override row has no percentage');
  return BigInt(row.rule_pct_bps);
}

/**
 * يبني مدخلات المحرك من الصف المحفوظ: السطر والتجاوز بييجوا من الداتابيز نفسها.
 *
 * @param fixture    خط الفحص بستافاته الثابتة
 * @param row        الصف المحفوظ في الداتابيز
 * @param overrideId معرف التجاوز المحفوظ
 * @returns مدخلات فترة جاهزة للمحرك
 */
function engineInput(
  fixture: CommissionServiceOverrideFixture,
  row: SavedOverrideRow,
  overrideId: string,
): CommissionPeriodInput {
  return {
    employeeId: fixture.employee,
    period: '2026-10',
    periodLastDay: '2026-10-31',
    lines: [
      {
        employeeId: fixture.employee,
        serviceId: row.service_id,
        lineId: 'a',
        occurredAt: 1n,
        recordedAt: 1n,
        businessDate: '2026-10-30',
        netShare: 10000n,
        shareBps: 5000n,
        counts: true,
        ruleSnapshot: { kind: 'PCT', value: 1000n },
      },
    ],
    sales: [],
    versions: [
      {
        employeeId: fixture.employee,
        effectiveFrom: '2026-10-01',
        wholePeriod: false,
        createdAt: 1n,
        version: 1n,
        base: { enabled: true, calc: { kind: 'PCT', value: 2000n } },
        tiers: { enabled: false },
        packageSale: { enabled: false },
      },
    ],
    overrides: [
      {
        id: overrideId,
        employeeId: row.employee_id,
        serviceId: row.service_id,
        effectiveFrom: row.effective_from,
        createdAt: BigInt(row.created_at_micros),
        rule: { kind: 'PCT', value: savedBps(row) },
      },
    ],
    salaries: [],
  } satisfies CommissionPeriodInput;
}

/**
 * يتأكد إن تدقيق الإنشاء وثق السطر المحفوظ بس، بلا راتب ولا بيانات عميلة.
 *
 * @param created الصف المخزن الذي يفترض التدقيق توثيقه
 * @returns لا شيء؛ يتوقع تطابق صف التدقيق
 */
async function expectOverrideAudit(created: CommissionServiceOverride): Promise<void> {
  const audits = await f.h.owner`SELECT actor_user_id,entity,entity_id,action,after FROM audit_log
    WHERE action='commission_override.created'`;
  expect(audits).toHaveLength(1);
  expect(audits[0]?.['actor_user_id']).toBe(f.userId);
  expect(audits[0]?.['entity']).toBe('commission_service_override');
  expect(audits[0]?.['entity_id']).toBe(created.id);
  expect(audits[0]?.['after']).toEqual({
    id: created.id,
    employee_id: f.employee,
    service_id: f.service,
    rule: { kind: 'PCT', value: 1500 },
    effective_from: '2026-10-30',
    created_at: created.created_at,
    created_by: f.userId,
  });
}

it('CM-11 saves PCT 1500 and the saved row prices a shared line at 1.500 KWD', async () => {
  const created = await writeOverride(f, overrideInput(f), 'cm-11-pct-1500');
  expect(created.rule).toEqual({ kind: 'PCT', value: 1500 });
  // السطر المحفوظ في الداتابيز هو المرجع: بنقراه منها ونمرّره للمحرك زي ما استهلكه العامل.
  const row = await savedRow(created.id);
  expect(row.rule_kind).toBe('PCT');
  // 10000 فلس نصيب × 1500 بيس ÷ 10000 = 1500 فلس = 1.500 دينار؛ لقطة السطر 1000 والخطة 2000 مختلفين.
  expect(computePeriod(engineInput(f, row, created.id))).toEqual({
    ok: true,
    perSource: new Map([['line:a', 1500n]]),
    total: 1500n,
  });
  expect(await overrideAndAuditCounts(f)).toEqual([1, 1]);
  await expectOverrideAudit(created);
});

it.each([
  { label: 'FOLLOW_PLAN', rule: { kind: 'FOLLOW_PLAN' } },
  { label: 'ZERO', rule: { kind: 'ZERO' } },
  { label: 'PCT', rule: { kind: 'PCT', value: 1500 } },
  { label: 'FIXED', rule: { kind: 'FIXED', value: '12.500' } },
] satisfies { label: string; rule: CreateCommissionServiceOverrideInput['rule'] }[])(
  'persists and returns the $label rule unchanged, and the valueless kinds stay valueless',
  async ({ label, rule }) => {
    const created = await writeOverride(f, overrideInput(f, { rule }), `cm-11-rule-${label}`);
    expect(created.rule).toEqual(rule);
    const row = (await savedOverrideRows(f)).find((candidate) => candidate.id === created.id);
    expect(row?.rule_kind).toBe(rule.kind);
    if (rule.kind === 'PCT') expect(row?.rule_pct_bps).toBe(rule.value);
    else expect(row?.rule_pct_bps).toBeNull();
    if (rule.kind === 'FIXED') expect(row?.rule_fixed_amount).toBe(rule.value);
    else expect(row?.rule_fixed_amount).toBeNull();
  },
);

it('without any override the line keeps its own saved snapshot, not ZERO', async () => {
  const input = {
    employeeId: f.employee,
    period: '2026-10',
    periodLastDay: '2026-10-31',
    lines: [
      {
        employeeId: f.employee,
        serviceId: f.service,
        lineId: 'a',
        occurredAt: 1n,
        recordedAt: 1n,
        businessDate: '2026-10-30',
        netShare: 10000n,
        shareBps: 5000n,
        counts: true,
        ruleSnapshot: { kind: 'PCT', value: 1000n },
      },
    ],
    sales: [],
    versions: [],
    overrides: [],
    salaries: [],
  } satisfies CommissionPeriodInput;
  // مفيش تجاوز خالص: اللقطة هي اللي بتتحسب، مش صفر.
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([['line:a', 1000n]]),
    total: 1000n,
  });
});

it('a missing employee is refused and leaves no row, no audit and no stored success', async () => {
  const before = await overrideAndAuditCounts(f);
  await expect(
    runOverride(f, overrideInput(f), 'cm-11-missing-employee', { employeeId: ids.newId() }),
  ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(await idempotencyClaims(f)).toBe(0);
});

it.each([
  {
    label: 'a service that does not exist',
    service: () => ids.newId(),
  },
  {
    label: 'a service of another business in the same company',
    service: (f: CommissionServiceOverrideFixture) => f.otherBusinessService,
  },
  {
    label: 'a service of another company',
    service: (f: CommissionServiceOverrideFixture) => f.otherTenantService,
  },
])(
  'is refused for $label and leaves no row, no audit and no stored success',
  async ({ label, service }) => {
    const before = await overrideAndAuditCounts(f);
    await expect(
      runOverride(
        f,
        overrideInput(f, { service_id: service(f) }),
        `cm-11-service-${label.replaceAll(' ', '-')}`,
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
    expect(await overrideAndAuditCounts(f)).toEqual(before);
    expect(await idempotencyClaims(f)).toBe(0);
  },
);
