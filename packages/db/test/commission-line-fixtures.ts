import { employeeNameMatchKey } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import type { ClaimedEvent, IdGenerator, Tx } from '../src/index.ts';
import {
  COMMISSION_TENANT,
  OTHER_COMMISSION_IDS,
  seedCommissionStatementTenants,
  type CommissionTenant,
} from './commission-statement-fixtures.ts';
import { USER } from './tenancy-fixtures.ts';

export const COMMISSION_LINE_IDS = {
  lineA: '01920000-0000-7000-8000-00000000d501',
  lineB: '01920000-0000-7000-8000-00000000d502',
  sessionA: '01920000-0000-7000-8000-00000000d401',
  serviceA: '01920000-0000-7000-8000-00000000d101',
  serviceB: '01920000-0000-7000-8000-00000000d102',
  customerA: '01920000-0000-7000-8000-00000000d201',
  customerB: '01920000-0000-7000-8000-00000000d202',
  secondEmployee: '01920000-0000-7000-8000-00000000d301',
  thirdEmployee: '01920000-0000-7000-8000-00000000d302',
} as const;

export interface CommissionLineTenant extends CommissionTenant {
  readonly service: string;
  readonly customer: string;
}

export const COMMISSION_LINE_TENANTS = {
  A: {
    ...COMMISSION_TENANT.A,
    service: COMMISSION_LINE_IDS.serviceA,
    customer: COMMISSION_LINE_IDS.customerA,
  },
  B: {
    ...COMMISSION_TENANT.B,
    service: COMMISSION_LINE_IDS.serviceB,
    customer: COMMISSION_LINE_IDS.customerB,
  },
} as const satisfies Record<string, CommissionLineTenant>;

/** يزرع مراجع البنود في شركتين، ومنفّذتين إضافيتين وخدمة نشاط آخر داخل شركة A. */
export async function seedCommissionLineTenants(ownerUrl: string): Promise<void> {
  await seedCommissionStatementTenants(ownerUrl);
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const { A, B } = COMMISSION_LINE_TENANTS;
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${A.company},${A.service},${A.business},'Projected service A',1.000,'ZERO')`;
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${B.company},${B.service},${B.business},'Projected service B',1.000,'ZERO')`;
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${A.company},${OTHER_COMMISSION_IDS.service},${OTHER_COMMISSION_IDS.business},
        'Other business service',1.000,'ZERO')`;
    await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
      VALUES(${A.company},${A.customer},'Projection customer A','+96500000001','ar',now(),now())`;
    await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
      VALUES(${B.company},${B.customer},'Projection customer B','+96500000002','ar',now(),now())`;
    for (const [id, name, employeeNumber] of [
      [COMMISSION_LINE_IDS.secondEmployee, 'Second performer', 10],
      [COMMISSION_LINE_IDS.thirdEmployee, 'Third performer', 11],
    ] as const) {
      await owner`INSERT INTO employees(
        company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
        VALUES(${A.company},${id},${A.business},${A.branch},${name},${employeeNameMatchKey(name)},
          'staff','2026-01-01',${employeeNumber})`;
    }
  } finally {
    await owner.end();
  }
}

type RowOverrides = Record<string, unknown>;
const value = (row: RowOverrides, key: string, fallback: unknown) =>
  key in row ? row[key] : fallback;

/** يدرج رأس بند بقيم صالحة قابلة للتجاوز عموداً بعمود. */
export async function insertCommissionLineHead(
  tx: Tx,
  tenant: CommissionLineTenant,
  ids: IdGenerator,
  row: RowOverrides = {},
): Promise<string> {
  const lineId = value(row, 'lineId', ids.newId()) as string;
  await tx.execute(sql`INSERT INTO commission_line_heads(
    company_id,business_id,line_id,session_id,branch_id,service_id,customer_id,revision,status,
    business_date,period)
    VALUES(${value(row, 'companyId', tenant.company)},${value(row, 'businessId', tenant.business)},
      ${lineId},${value(row, 'sessionId', COMMISSION_LINE_IDS.sessionA)},
      ${value(row, 'branchId', tenant.branch)},${value(row, 'serviceId', tenant.service)},
      ${value(row, 'customerId', tenant.customer)},${value(row, 'revision', 1)},
      ${value(row, 'status', 'ACTIVE')},${value(row, 'businessDate', '2026-11-01')},
      ${value(row, 'period', '2026-11')})`);
  return lineId;
}

/** يدرج صف نصيب منفّذة بقيم صالحة؛ الفلوس تبقى نصوص numeric بلا number. */
export async function insertCommissionLineRow(
  tx: Tx,
  tenant: CommissionLineTenant,
  ids: IdGenerator,
  row: RowOverrides = {},
): Promise<string> {
  const lineId = value(row, 'lineId', ids.newId()) as string;
  const kind = value(row, 'ruleKind', 'ZERO');
  await tx.execute(sql`INSERT INTO commission_lines(
    company_id,business_id,line_id,branch_id,employee_id,service_id,occurred_at,recorded_at,
    business_date,period,net,net_share,share_bps,rule_kind,rule_pct_bps,rule_fixed_amount,counts,status)
    VALUES(${value(row, 'companyId', tenant.company)},${value(row, 'businessId', tenant.business)},
      ${lineId},${value(row, 'branchId', tenant.branch)},${value(row, 'employeeId', tenant.employee)},
      ${value(row, 'serviceId', tenant.service)},${value(row, 'occurredAt', '2026-11-01T09:00:00Z')},
      ${value(row, 'recordedAt', '2026-11-01T09:00:00Z')},${value(row, 'businessDate', '2026-11-01')},
      ${value(row, 'period', '2026-11')},${value(row, 'net', '10.001')},
      ${value(row, 'netShare', value(row, 'net', '10.001'))},${value(row, 'shareBps', 10000)},
      ${kind},${value(row, 'rulePctBps', kind === 'PCT' ? 0 : null)},
      ${value(row, 'ruleFixedAmount', kind === 'FIXED' ? '0.000' : null)},
      ${value(row, 'counts', true)},${value(row, 'status', 'ACTIVE')})`);
  return lineId;
}

/** يدرج رأساً وصف منفّذة واحدة مترابطين لاختبارات round-trip والعزل. */
export async function insertCommissionLineProjection(
  tx: Tx,
  tenant: CommissionLineTenant,
  ids: IdGenerator,
  row: RowOverrides = {},
): Promise<string> {
  const lineId = value(row, 'lineId', ids.newId()) as string;
  await insertCommissionLineHead(tx, tenant, ids, { ...row, lineId });
  await insertCommissionLineRow(tx, tenant, ids, { ...row, lineId });
  return lineId;
}

function linePayload(tenant: CommissionLineTenant, row: RowOverrides = {}): RowOverrides {
  const revision = value(row, 'revision', 1) as number;
  const performers = value(row, 'performers', [
    { employee_id: tenant.employee, share_bps: 10000 },
  ]);
  const net = value(row, 'net', '10.001');
  const changeKind = value(row, 'changeKind', undefined);
  const previous =
    changeKind === 'PERFORMERS_CHANGE'
      ? {
          revision: revision - 1,
          performers: value(row, 'previousPerformers', [
            { employee_id: tenant.employee, share_bps: 10000 },
          ]),
        }
      : {
          revision: revision - 1,
          price: net,
          discount: '0.000',
          net: value(row, 'previousNet', net),
        };
  return {
    line_id: value(row, 'lineId', COMMISSION_LINE_IDS.lineA),
    session_id: value(row, 'sessionId', COMMISSION_LINE_IDS.sessionA),
    service_id: value(row, 'serviceId', tenant.service),
    branch_id: value(row, 'branchId', tenant.branch),
    business_id: value(row, 'businessId', tenant.business),
    customer_id: value(row, 'customerId', tenant.customer),
    status: value(row, 'status', changeKind === 'LINE_CANCELLED' ? 'CANCELLED' : 'ACTIVE'),
    occurred_at: value(row, 'occurredAt', '2026-11-01T09:00:00.000Z'),
    recorded_at: value(row, 'recordedAt', '2026-11-01T09:00:00.000Z'),
    business_date: value(row, 'businessDate', '2026-11-01'),
    late: false,
    recorded_by: USER,
    recorded_by_membership_id: tenant.membership,
    list_price: net,
    price: net,
    discount: '0.000',
    net,
    performers,
    rule_snapshot: value(row, 'ruleSnapshot', { kind: 'ZERO' }),
    counts_snapshot: value(row, 'counts', true),
    package: null,
    revision,
    ...(changeKind === undefined
      ? {}
      : {
          change: {
            kind: changeKind,
            changed_at: value(row, 'recordedAt', '2026-11-01T09:00:00.000Z'),
            changed_by: USER,
            changed_by_membership_id: tenant.membership,
            previous,
          },
        }),
  };
}

/** يبني حدث تسجيل أو إضافة أو تغيير بند كامل بصيغة العقد الحقيقية. */
export function commissionLineEvent(
  tenant: CommissionLineTenant,
  ids: IdGenerator,
  eventType: 'ServiceSessionRecorded' | 'ServiceSessionLinesAdded' | 'ServiceLineChanged',
  row: RowOverrides = {},
): ClaimedEvent {
  const lines = (value(row, 'lines', [row]) as readonly RowOverrides[]).map((line) =>
    linePayload(tenant, line),
  );
  const sessionId = value(row, 'sessionId', COMMISSION_LINE_IDS.sessionA);
  const payload =
    eventType === 'ServiceLineChanged'
      ? lines[0]
      : {
          schema_version: 1,
          session_id: sessionId,
          business_id: value(row, 'businessId', tenant.business),
          branch_id: value(row, 'branchId', tenant.branch),
          customer_id: value(row, 'customerId', tenant.customer),
          occurred_at: value(row, 'occurredAt', '2026-11-01T09:00:00.000Z'),
          recorded_at: value(row, 'recordedAt', '2026-11-01T09:00:00.000Z'),
          business_date: value(row, 'businessDate', '2026-11-01'),
          business_timezone: 'Asia/Kuwait',
          late: false,
          recorded_by: USER,
          recorded_by_membership_id: tenant.membership,
          lines,
        };
  return {
    companyId: value(row, 'companyId', tenant.company) as string,
    id: value(row, 'id', ids.newId()) as string,
    aggregateType: value(row, 'aggregateType', 'service_session') as string,
    aggregateId: value(row, 'aggregateId', sessionId) as string,
    eventType,
    payload,
    attempt: value(row, 'attempt', 1) as number,
  };
}
