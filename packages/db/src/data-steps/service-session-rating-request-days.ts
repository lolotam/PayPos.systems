import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { Tx } from '../with-tenant.ts';
import type { DataStepApp } from './coverage.ts';

const BATCH_SIZE = 200;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const RATING_DELAY_MS = 60 * MINUTE_MS;
const SEND_GRACE_MS = 30 * MINUTE_MS;

interface OpeningIntervalValue {
  readonly opens: string;
  readonly closes: string;
}

interface OpeningDayValue {
  readonly weekday: number;
  readonly intervals: readonly OpeningIntervalValue[];
}

type SessionCandidateRow = {
  readonly id: string;
  readonly business_id: string;
  readonly customer_id: string;
  readonly occurred_at: Date | string;
  readonly recorded_at: Date | string;
  readonly opening_hours: unknown;
  readonly visit_timezone: string | null;
};

type CandidateRequestRow = {
  readonly business_id: string;
  readonly customer_id: string;
  readonly business_date: string;
  readonly due_at: Date | string;
  readonly send_deadline: Date | string | null;
  readonly claimed_at: Date | string | null;
  readonly request_timezone: string | null;
};

interface ParsedRequest {
  readonly businessDate: string;
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
  readonly claimedAt: Date | null;
  readonly requestTimeZone: string;
}

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: بدون هذا التجاوز تعيد قراءة الشركات تحت FORCE RLS
 * صفر صفوف فتفشل الخطوة صامتةً دون تعبئة أي زيارة قائمة.
 */
export class ServiceSessionRatingRequestDaysRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step service-session-rating-request-days needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/** عدّادات تعبئة يوم طلب التقييم للزيارات السابقة بلا أسماء أو بيانات مستأجرين. */
export interface ServiceSessionRatingRequestDaysResult {
  /** عدد الشركات المقروءة معرفاتها من اتصال المالك. */
  readonly companies: number;
  /** عدد الزيارات غير الموسومة المرشحة للمطابقة. */
  readonly read: number;
  /** عدد الزيارات التي ثُبِّت يوم طلب التقييم لها. */
  readonly assigned: number;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function localParts(
  instant: Date,
  timeZone: string,
): { readonly date: string; readonly minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function addCivilDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function isoWeekdayOf(date: string): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function clockMinutes(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function parseOpeningHours(value: unknown): readonly OpeningDayValue[] | null {
  if (!Array.isArray(value)) return null;
  const days: OpeningDayValue[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { weekday?: unknown; intervals?: unknown };
    if (typeof candidate.weekday !== 'number' || !Array.isArray(candidate.intervals)) continue;
    const intervals: OpeningIntervalValue[] = [];
    for (const item of candidate.intervals) {
      if (typeof item !== 'object' || item === null) continue;
      const interval = item as { opens?: unknown; closes?: unknown };
      if (typeof interval.opens === 'string' && typeof interval.closes === 'string') {
        intervals.push({ opens: interval.opens, closes: interval.closes });
      }
    }
    days.push({ weekday: candidate.weekday, intervals });
  }
  return days;
}

function branchRequestDayOf(
  occurredAt: Date,
  timeZone: string,
  openingHours: unknown,
): { readonly localDate: string; readonly previousDate: string; readonly branchDay: string } {
  const local = localParts(occurredAt, timeZone);
  const previousDate = addCivilDays(local.date, -1);
  const parsedHours = parseOpeningHours(openingHours);
  if (parsedHours === null || parsedHours.length === 0) {
    return { localDate: local.date, previousDate, branchDay: local.date };
  }
  const previousDay = parsedHours.find((day) => day.weekday === isoWeekdayOf(previousDate));
  const inOvernightTail = previousDay?.intervals.some(
    (interval) =>
      clockMinutes(interval.closes) < clockMinutes(interval.opens) &&
      local.minutes < clockMinutes(interval.closes),
  );
  return {
    localDate: local.date,
    previousDate,
    branchDay: inOvernightTail === true ? previousDate : local.date,
  };
}

function matchesBeforeClaim(recordedAt: Date, request: ParsedRequest): boolean {
  return request.claimedAt === null || recordedAt.getTime() <= request.claimedAt.getTime();
}

function matchesOvernightFallback(
  occurredAt: Date,
  recordedAt: Date,
  previousDate: string,
  prevReq: ParsedRequest,
): boolean {
  if (prevReq.sendDeadline === null || !matchesBeforeClaim(recordedAt, prevReq)) return false;
  const closeMs = prevReq.sendDeadline.getTime() - SEND_GRACE_MS;
  if (localParts(new Date(closeMs), prevReq.requestTimeZone).date <= previousDate) return false;
  const occurredMs = occurredAt.getTime();
  if (occurredMs >= closeMs) return false;
  return prevReq.dueAt.getTime() >= Math.min(occurredMs + RATING_DELAY_MS, closeMs);
}

function resolveSessionDay(
  row: SessionCandidateRow,
  byCustomerDay: ReadonlyMap<string, ParsedRequest>,
): string | null {
  const timeZone = row.visit_timezone ?? 'Asia/Kuwait';
  const occurredAt = toDate(row.occurred_at);
  const recordedAt = toDate(row.recorded_at);
  const { localDate, previousDate, branchDay } = branchRequestDayOf(
    occurredAt,
    timeZone,
    row.opening_hours,
  );
  const keyPrefix = `${row.business_id}|${row.customer_id}|`;
  const prevReq = byCustomerDay.get(`${keyPrefix}${previousDate}`);
  const currReq = byCustomerDay.get(`${keyPrefix}${localDate}`);

  if (prevReq !== undefined) {
    if (branchDay === previousDate) {
      return previousDate;
    }
    if (matchesOvernightFallback(occurredAt, recordedAt, previousDate, prevReq)) {
      return previousDate;
    }
  }
  if (branchDay === localDate && currReq !== undefined) {
    const cutoff = (currReq.sendDeadline ?? currReq.dueAt).getTime();
    if (occurredAt.getTime() <= cutoff) return localDate;
  }
  return null;
}

async function loadCandidateRequests(
  tx: Tx,
  companyId: string,
  rows: readonly SessionCandidateRow[],
): Promise<Map<string, ParsedRequest>> {
  const customerIds = [...new Set(rows.map((row) => row.customer_id))];
  const dates = rows.map(
    (row) => localParts(toDate(row.occurred_at), row.visit_timezone ?? 'Asia/Kuwait').date,
  );
  const sortedDates = [...dates].sort();
  const earliest = sortedDates[0];
  const latest = sortedDates.at(-1);
  if (earliest === undefined || latest === undefined) return new Map();
  const minDate = addCivilDays(earliest, -1);
  const maxDate = latest;
  const idList = sql.join(
    customerIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const requests = await tx.execute<CandidateRequestRow>(sql`
    SELECT r.business_id, r.customer_id, r.business_date::text AS business_date,
           r.due_at, r.send_deadline, r.claimed_at,
           COALESCE(rb.timezone, rbu.timezone) AS request_timezone
    FROM rating_requests AS r
    JOIN branches AS rb
      ON rb.company_id = r.company_id
      AND rb.business_id = r.business_id
      AND rb.id = r.branch_id
    JOIN businesses AS rbu
      ON rbu.company_id = rb.company_id
      AND rbu.id = rb.business_id
    WHERE r.company_id = ${companyId}::uuid
      AND r.customer_id IN (${idList})
      AND r.business_date BETWEEN ${minDate}::date AND ${maxDate}::date
  `);
  const map = new Map<string, ParsedRequest>();
  for (const req of requests) {
    map.set(`${req.business_id}|${req.customer_id}|${req.business_date}`, {
      businessDate: req.business_date,
      dueAt: toDate(req.due_at),
      sendDeadline: req.send_deadline === null ? null : toDate(req.send_deadline),
      claimedAt: req.claimed_at === null ? null : toDate(req.claimed_at),
      requestTimeZone: req.request_timezone ?? 'Asia/Kuwait',
    });
  }
  return map;
}

async function backfillCompanyBatch(
  tx: Tx,
  companyId: string,
  afterId: string | null,
): Promise<{ readonly read: number; readonly assigned: number; readonly lastId: string | null }> {
  const afterFilter = afterId === null ? sql`TRUE` : sql`s.id > ${afterId}::uuid`;
  const rows = await tx.execute<SessionCandidateRow>(sql`
    SELECT s.id, s.business_id, s.customer_id, s.occurred_at, s.recorded_at,
           b.opening_hours, COALESCE(b.timezone, bu.timezone) AS visit_timezone
    FROM service_sessions AS s
    JOIN branches AS b
      ON b.company_id = s.company_id
      AND b.business_id = s.business_id
      AND b.id = s.branch_id
    JOIN businesses AS bu
      ON bu.company_id = b.company_id
      AND bu.id = b.business_id
    WHERE s.company_id = ${companyId}::uuid
      AND ${afterFilter}
      AND s.rating_request_day IS NULL
      AND s.customer_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM rating_requests AS r
        WHERE r.company_id = s.company_id
          AND r.business_id = s.business_id
          AND r.customer_id = s.customer_id
      )
    ORDER BY s.id ASC
    LIMIT ${BATCH_SIZE}
  `);
  if (rows.length === 0) return { read: 0, assigned: 0, lastId: null };

  const requests = await loadCandidateRequests(tx, companyId, rows);
  let assigned = 0;
  for (const row of rows) {
    const resolved = resolveSessionDay(row, requests);
    if (resolved === null) continue;
    const updated = await tx.execute<{ id: string }>(sql`
      UPDATE service_sessions
      SET rating_request_day = ${resolved}::date
      WHERE company_id = ${companyId}::uuid
        AND id = ${row.id}::uuid
        AND rating_request_day IS NULL
      RETURNING id
    `);
    assigned += updated.length;
  }
  return { read: rows.length, assigned, lastId: rows.at(-1)?.id ?? null };
}

/**
 * يعبّئ `service_sessions.rating_request_day` للزيارات السابقة التي تطابق طلب تقييم قائماً
 * في معاملات مستأجر محدودة الحجم (`withTenant` على `pospay_app`) دون احتجاز أقفال الجدول،
 * مع الاعتماد على جدول مواعيد فرع الزيارة نفسه واستقلاله عن `rating_requests.branch_id`.
 *
 * @param owner اتصال الترحيل لاكتشاف معرفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @returns أعداد الشركات والزيارات المقروءة والموسومة دون أسماء
 */
export async function backfillServiceSessionRatingRequestDays(
  owner: postgres.Sql,
  app: DataStepApp,
): Promise<ServiceSessionRatingRequestDaysResult> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new ServiceSessionRatingRequestDaysRoleRefusedError();

  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  const counts = { companies: companies.length, read: 0, assigned: 0 };
  for (const { id: companyId } of companies) {
    let afterId: string | null = null;
    for (;;) {
      const batch = await app.withTenant(companyId, (tx) =>
        backfillCompanyBatch(tx, companyId, afterId),
      );
      counts.read += batch.read;
      counts.assigned += batch.assigned;
      if (batch.lastId === null || batch.read < BATCH_SIZE) break;
      afterId = batch.lastId;
    }
  }
  return counts;
}
