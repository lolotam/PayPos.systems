// زرع الطلبات المستحقة: عملاء وزيارات وبنود ومنفذين، عشان المطالبة تلاقي بند نشط في يوم الطلب.
import type postgres from 'postgres';

import { ORDER_IDS } from '../../../../../packages/db/test/orders-fixture.ts';

/** الصفوف المزروعة: الطلبات والعملاء بترتيب تصاعدي. */
export interface SeededRows {
  readonly requestIds: readonly string[];
  readonly customerIds: readonly string[];
}

/** خيارات زرع الطلبات المستحقة. */
export interface SeedOptions {
  readonly count: number;
  /** أول رقم في تسلسل المعرّفات، عشان الدفعة الجاية تكون أكبر أو أصغر. */
  readonly first?: number;
  /** خطوة التسلسل، عشان يبقى فيه فراغ بين المعرّفات. */
  readonly stride?: number;
  readonly dueAt?: Date;
  readonly sendDeadline?: Date | null;
  readonly occurredAt?: Date;
  readonly businessDate?: string;
  readonly businessId?: string;
  readonly company?: string;
}

/** الشركة اللي بتزرع فيها، والفرع اللي بتتبعه الزيارات. */
export interface SeedTarget {
  readonly company: string;
  readonly businessId: string;
  readonly branchId: string;
}

/** بيانات الدفعة الواحدة: المعرّفات والمواعيد المحسوبة. */
export interface SeedPlan {
  readonly company: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
  readonly businessDate: string;
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
  readonly first: number;
  readonly stride: number;
  readonly customerIds: string[];
  readonly sessionIds: string[];
  readonly lineIds: string[];
  readonly performerIds: string[];
  readonly requestIds: string[];
}

/** معرّفات متسلسلة ثابتة لكل جدول، عشان ترتيب الجولة يبقى متوقع في الاختبار. */
export function idsOf(prefix: string, first: number, count: number, stride: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const hex = (first + index * stride).toString(16);
    ids.push(`${prefix}${hex.padStart(4, '0')}-7000-8000-0000-${hex.padStart(12, '0')}`);
  }
  return ids;
}

/** يحسب معرّفات الدفعة ومواعيدها من الهدف والخيارات. */
export function seedPlan(target: SeedTarget, options: SeedOptions): SeedPlan {
  const first = options.first ?? 1;
  const count = options.count;
  const stride = options.stride ?? 1;
  return {
    company: options.company ?? target.company,
    businessId: options.businessId ?? target.businessId,
    branchId: target.branchId,
    occurredAt: options.occurredAt ?? VISIT_AT,
    businessDate: options.businessDate ?? BUSINESS_DATE,
    dueAt: options.dueAt ?? DUE_AT,
    sendDeadline: options.sendDeadline === undefined ? SEND_DEADLINE : options.sendDeadline,
    first,
    stride,
    customerIds: idsOf('1100', first, count, stride),
    sessionIds: idsOf('1200', first, count, stride),
    lineIds: idsOf('1300', first, count, stride),
    performerIds: idsOf('1400', first, count, stride),
    requestIds: idsOf('1500', first, count, stride),
  };
}

/**
 * يزرع زيارات حقيقية لكل طلب، لأن المطالبة بتلغي أي طلب مالوش بند نشط في يومه.
 *
 * السطور دي بتنزل جوه المعاملة اللي بتستدعيها؛ اتساق المنفذين متأخر لحد الـ commit،
 * فسطر لوحده بيقفل من غير منفذين ويرميه القيد.
 */
export async function seedVisitRows(runner: postgres.ISql, plan: SeedPlan): Promise<void> {
  await runner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    SELECT ${plan.company}, x.id, 'Seeded customer',
      '+9999998' || lpad((${plan.first} + (x.ord - 1) * ${plan.stride})::text, 5, '0'), 'en', now(), now()
    FROM unnest(${plan.customerIds}::uuid[]) WITH ORDINALITY AS x(id, ord)`;
  await runner`INSERT INTO service_sessions
    SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s) || jsonb_build_object('id', x.id::text, 'customer_id', x.customer_id::text,
        'occurred_at', ${plan.occurredAt}::timestamptz, 'recorded_at', ${plan.occurredAt}::timestamptz,
        'business_id', ${plan.businessId}::text, 'branch_id', ${plan.branchId}::text,
        'business_date', ${plan.businessDate}::date))).*
    FROM service_sessions s, unnest(${plan.sessionIds}::uuid[], ${plan.customerIds}::uuid[]) AS x(id, customer_id)
    WHERE s.company_id = ${plan.company} AND s.id = ${ORDER_IDS.session}`;
  await runner`INSERT INTO service_lines
    SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l) || jsonb_build_object('id', x.id::text, 'session_id', x.session_id::text,
        'business_id', ${plan.businessId}::text, 'status', 'ACTIVE'::text))).*
    FROM service_lines l, unnest(${plan.lineIds}::uuid[], ${plan.sessionIds}::uuid[]) AS x(id, session_id)
    WHERE l.company_id = ${plan.company} AND l.id = ${ORDER_IDS.line}`;
  await runner`INSERT INTO line_performers
    SELECT (jsonb_populate_record(NULL::line_performers,
      to_jsonb(p) || jsonb_build_object('id', x.id::text, 'line_id', x.line_id::text))).*
    FROM line_performers p, unnest(${plan.performerIds}::uuid[], ${plan.lineIds}::uuid[]) AS x(id, line_id)
    WHERE p.company_id = ${plan.company} AND p.id = ${ORDER_IDS.performer}`;
}

/** يزرع صفوف الطلبات نفسها، بحالة مجدولة وبدون أي ادعاء إرسال. */
export async function seedRequestRows(runner: postgres.ISql, plan: SeedPlan): Promise<void> {
  await runner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
    SELECT ${plan.company}, x.id, ${plan.businessId}, x.customer_id, ${plan.businessDate}::date, ${plan.branchId},
      ${plan.dueAt}::timestamptz, ${plan.sendDeadline}::timestamptz, 'SCHEDULED'
    FROM unnest(${plan.requestIds}::uuid[], ${plan.customerIds}::uuid[]) AS x(id, customer_id)`;
}

/**
 * يزرع الزيارات والطلبات في معاملة واحدة.
 *
 * القيدان المؤجلان بيفحصوا السطور لما المعاملة تقفل، فزرع السطر في معاملة لوحده
 * بيقفله من غير منفذين ويرمي "Invalid performer set".
 */
export async function seedDueRows(runner: postgres.Sql, plan: SeedPlan): Promise<void> {
  await runner.begin(async (tx) => {
    await seedVisitRows(tx, plan);
    await seedRequestRows(tx, plan);
  });
}

/** لحظة الزيارة الثابتة؛ منها بتتحسب مواعيد الاستحقاق والإرسال. */
export const VISIT_AT = new Date('2026-06-01T12:10:00.000Z');
/** موعد الاستحقاق: ساعة بعد الزيارة. */
export const DUE_AT = new Date('2026-06-01T13:10:00.000Z');
/** الموعد النهائي للإرسال: الإغلاق زائد نص ساعة. */
export const SEND_DEADLINE = new Date('2026-06-01T19:30:00.000Z');
/** يوم الطلب الثابت في الاختبارات. */
export const BUSINESS_DATE = '2026-06-01';
