import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { COMMISSION_REMINDER_SCHEDULES_LOST_CODE } from '@pospay/domain';

/**
 * هوية النظام اللي بتمسح بيه علامة ضياع جدولة التذكيرات (ADR-0061 §3).
 * ثابت معروف ومش متاح للكتابة من أي دور تشغيل.
 */
export const REMINDER_RECOVERY_SYSTEM_CLEARED_BY = '00000000-0000-7000-8000-000000000061';

/**
 * كود حادثة ضياع جدولة تذكيرات كشف العمولة (ADR-0054 §2، ADR-0061 §1).
 * الكود ده هو الوحيد اللي استعادة التذكير بتتعامل معاه.
 */
export { COMMISSION_REMINDER_SCHEDULES_LOST_CODE };

/**
 * عتبة الاستعادة: وقت PostgreSQL اللي اتقرا في جملة لوحدها، وآخر رقم تسلسلي في الأوتبوكس وقت القراء.
 * الرقم التسلسلي هو السور الرتيباني اللي بيحمي من رجوع الساعة (ADR-0061 §2، البند 2 من #1222).
 */
export interface ReminderRecoveryCutoff {
  readonly cutoff: Date;
  readonly maxOutboxSeq: string;
}

/** علامة تشغيلية مفتوحة: هويتها وكودها ووقت رفعها. */
export interface OpenRecoveryFlag {
  readonly id: string;
  readonly code: string;
  readonly raisedAt: Date;
}

/**
 * صفحة أحداث `CompanyCreated` الموقوفة بعد العتبة: هويات الشركات (من غير تكرار) وعلامة الفيضان
 * ووقت PostgreSQL في نفس الجملة (ADR-0061 §2).
 */
export interface ParkedCompanyPage {
  readonly companyIds: readonly string[];
  readonly overflow: boolean;
  readonly dbNow: Date;
}

/** مدخلات مسح علامة ضياع الجدولة: هوية العلامة، ومعرّف التشغيل، ومعرّف المرور، وعدد الشركات، ومعرّف التدقيق. */
export interface ClearReminderFlagInput {
  readonly flagId: string;
  readonly rebuiltRunId: string;
  readonly rebuiltPassId: string;
  readonly companiesRebuilt: number;
  readonly auditId: string;
}

/**
 * واجهة استعادة الجدولة على واجهة المرسِل (ADR-0061 §1): قراءة معرّفات الشركات، ورفع العلامات، وقراءتها،
 * ومسح علامة واحدة من غير غيرها. مفيش عميل خام ولا أي طريق تاني للقاعدة.
 */
export interface ReminderRecoveryDatabase {
  /** يقرأ العتبة وآخر رقم تسلسلي في الأوتبوكس في جملة واحدة لوحدها. */
  sampleReminderRecoveryCutoff(): Promise<ReminderRecoveryCutoff>;
  /** يقرأ صفحة من معرّفات الشركات الحيّة بالترتيب التصاعدي، بالمؤشر والمقاس المقطوعين في الدالة نفسها. */
  companyIdPage(afterId: string | null, pageSize: number): Promise<readonly string[]>;
  /** يرفع علامة مفتوحة؛ لو في علامة مفتوحة لنفس الكود بيرجع `raised: false` من غير صف جديد. */
  raiseRecoveryFlag(id: string, code: string): Promise<{ raised: boolean; raisedAt: Date | null }>;
  /** يقرأ كل العلامات المفتوحة، الأقدم أول. */
  openRecoveryFlags(): Promise<readonly OpenRecoveryFlag[]>;
  /** يمسح علامة ضياع الجدولة لو كانت لسه مفتوحة؛ `false` معناها ما اتمسحتش (ADR-0061 §3). */
  clearReminderSchedulesLostFlag(input: ClearReminderFlagInput): Promise<boolean>;
  /** يقرأ أحداث `CompanyCreated` الموقوفة بعد العتبة، مع سور الرقم التسلسلي وعلامة الفيضان. */
  parkedCompanyCreatedAfter(
    cutoff: Date,
    cutoffSeq?: string | bigint,
  ): Promise<ParkedCompanyPage>;
}

const asText = (value: string | bigint): string =>
  typeof value === 'bigint' ? value.toString(10) : value;

/**
 * بيحوّل وقت PostgreSQL (نص بصيغة `YYYY-MM-DD HH:MM:SS[.ffffff]+HH`) لـ Date.
 * JavaScript مش بيقرأ إزاحة زي `+00` من غير دقايق، فبنكمّلها؛ وكل وقت غير مقروء بيرفض بدل ما يبقى NaN.
 *
 * @param value القيمة كما رجعت من القاعدة
 * @returns الوقت كـ Date
 */
const asDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  const text = String(value ?? '').trim();
  const parsed = new Date(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(parsed.getTime())) throw new Error('REMINDER_RECOVERY_TIMESTAMP_INVALID');
  return parsed;
};

/**
 * يقرأ عتبة الاستعادة: `statement_timestamp()` في جملة لوحدها، وآخر رقم تسلسلي في الأوتبوكس في نفس الجملة.
 * الجملة لوحدها عشان العتبة تسبق كل صفحة بعدها في القراءة (ADR-0061 §2، الخطوة 1).
 *
 * @param tx معاملة القراءة بعد التأكد من الدور
 * @returns العتبة وآخر رقم تسلسلي
 */
async function readRecoveryCutoff(
  tx: Pick<PostgresJsDatabase, 'execute'>,
): Promise<ReminderRecoveryCutoff> {
  const [row] = await tx.execute<{ cutoff: string; max_seq: string; snap: string }>(sql`
    SELECT pg_catalog.statement_timestamp() AS cutoff,
           COALESCE((SELECT MAX(seq) FROM outbox), 0)::text AS max_seq,
           pg_catalog.pg_current_snapshot()::text AS snap`);
  if (row === undefined) throw new Error('REMINDER_RECOVERY_CUTOFF_UNAVAILABLE');
  return { cutoff: asDate(row.cutoff), maxOutboxSeq: `${row.max_seq}@${row.snap}` };
}

/**
 * يقرأ صفحة معرّفات الشركات بالاستدعاء definer واحد (ADR-0061 §1): الدالة هي اللي بتفرض المؤشر
 * والمقاس المقطوع على ألف صف وشروط «الشركات الحيّة»، فالقارئ والعامل بيشوفوا نفس القائمة.
 *
 * @param tx       معاملة القراءة بعد التأكد من الدور
 * @param afterId  المؤشر: معرّف الشركة اللي قبلها في الترتيب، وnull يعني من الأول
 * @param pageSize أقصى عدد صفوف في الصفحة
 * @returns معرّفات الشركات في الترتيب التصاعدي
 */
async function readCompanyIdPage(
  tx: Pick<PostgresJsDatabase, 'execute'>,
  afterId: string | null,
  pageSize: number,
): Promise<readonly string[]> {
  const cursor = afterId === null ? sql`NULL::uuid` : sql`${afterId}::uuid`;
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM public.recovery_company_ids(${cursor}, ${pageSize}::integer)`);
  return rows.map((row) => row.id);
}

/**
 * يقرأ أحداث `CompanyCreated` الموقوفة بعد العتبة في جملة واحدة: وقت PostgreSQL، ومعرّفات الشركات
 * (من غير تكرار، ومحدودة بمية)، وعلامة الفيضان لما يكون في صف مشترك (ADR-0061 §2، البند 2 من #1222).
 * السور بالرقم التسلسلي والـ snapshot بيلقط الصف اللي `parked_at` فيه قبل العتبة أو كان مفتوحًا وقتها لو الساعة رجعت.
 *
 * @param tx        معاملة القراءة بعد التأكد من الدور
 * @param cutoff    عتبة الاستعادة المقروءة من PostgreSQL
 * @param cutoffSeq سور الرقم التسلسلي والـ snapshot وقت العتبة
 * @returns معرّفات الشركات وعلامة الفيضان ووقت PostgreSQL
 */
async function readParkedCompanyPage(
  tx: Pick<PostgresJsDatabase, 'execute'>,
  cutoff: Date,
  cutoffSeq: string | bigint,
): Promise<ParkedCompanyPage> {
  const [seqPart, snapPart] = asText(cutoffSeq).split('@');
  const seqVal = seqPart !== undefined && /^\d+$/.test(seqPart) ? seqPart : '0';
  const snapshotFence =
    snapPart !== undefined && /^\d+:\d+:[\d,]*$/.test(snapPart)
      ? sql`OR NOT pg_catalog.pg_visible_in_snapshot(o.xmin::text::pg_catalog.xid8, ${snapPart}::pg_catalog.pg_snapshot)`
      : sql``;
  const [row] = await tx.execute<{
    db_now: string;
    company_ids: string[] | null;
    candidate_count: string;
  }>(sql`
    WITH clock AS (SELECT pg_catalog.statement_timestamp() AS db_now),
    candidates AS (
      SELECT o.company_id, o.seq FROM outbox o
      WHERE o.event_type = 'CompanyCreated' AND o.parked_at IS NOT NULL AND o.published_at IS NULL
        AND (o.parked_at > ${cutoff.toISOString()}::timestamptz OR o.seq > ${seqVal}::bigint ${snapshotFence})
      ORDER BY o.seq ASC LIMIT 101)
    SELECT (SELECT db_now FROM clock) AS db_now,
           (SELECT pg_catalog.array_agg(c.company_id ORDER BY c.seq) FROM candidates c) AS company_ids,
           (SELECT pg_catalog.count(*)::text FROM candidates c) AS candidate_count`);
  if (row === undefined) throw new Error('REMINDER_RECOVERY_PARKED_PAGE_UNAVAILABLE');
  const companyIds = [...new Set(row.company_ids ?? [])].slice(0, 100);
  return {
    companyIds,
    overflow: Number(row.candidate_count) > 100,
    dbNow: asDate(row.db_now),
  };
}

/**
 * بيبني قراءات استعادة الجدولة على واجهة المرسّل (ADR-0061 §1): كلها على `pospay_dispatcher`،
 * وكل واحدة في معاملتها، ومفيش طريق تاني غير الـ facade دي.
 *
 * @param db        اتصال الدور
 * @param assertRole التأكد إن الاتصال بدور المرسّل
 * @returns قراءات الاستعادة
 */
export function reminderRecoveryReaders(
  db: PostgresJsDatabase,
  assertRole: (runner: Pick<PostgresJsDatabase, 'execute'>) => Promise<void>,
): ReminderRecoveryDatabase {
  return {
    sampleReminderRecoveryCutoff: () =>
      db.transaction(async (tx) => {
        await assertRole(tx);
        return readRecoveryCutoff(tx);
      }),
    companyIdPage: (afterId, pageSize) =>
      db.transaction(async (tx) => {
        await assertRole(tx);
        return readCompanyIdPage(tx, afterId, pageSize);
      }),
    raiseRecoveryFlag: (id, code) =>
      db.transaction(async (tx) => {
        await assertRole(tx);
        const rows = await tx.execute<{ raised_at: string }>(sql`
          INSERT INTO public.operational_recovery_flags (id, code, raised_at)
          VALUES (${id}::uuid, ${code}, pg_catalog.statement_timestamp())
          ON CONFLICT (code) WHERE cleared_at IS NULL DO NOTHING
          RETURNING raised_at`);
        const row = rows[0];
        return { raised: row !== undefined, raisedAt: row === undefined ? null : asDate(row.raised_at) };
      }),
    openRecoveryFlags: () =>
      db.transaction(async (tx) => {
        await assertRole(tx);
        const rows = await tx.execute<{ id: string; code: string; raised_at: string }>(sql`
          SELECT id, code, raised_at FROM public.operational_recovery_flags
          WHERE cleared_at IS NULL ORDER BY raised_at ASC, id ASC`);
        return rows.map((row) => ({
          id: row.id,
          code: row.code,
          raisedAt: asDate(row.raised_at),
        }));
      }),
    clearReminderSchedulesLostFlag: (input) =>
      db.transaction(async (tx) => {
        await assertRole(tx);
        const [row] = await tx.execute<{ cleared: boolean }>(sql`
          SELECT public.clear_reminder_schedules_lost_flag(
            ${input.flagId}::uuid, ${input.rebuiltRunId}, ${input.rebuiltPassId}::uuid,
            ${input.companiesRebuilt}::integer, ${input.auditId}::uuid) AS cleared`);
        return row?.cleared === true;
      }),
    parkedCompanyCreatedAfter: (cutoff, cutoffSeq) =>
      db.transaction(async (tx) => {
        await assertRole(tx);
        return readParkedCompanyPage(tx, cutoff, cutoffSeq === undefined ? '0' : cutoffSeq);
      }),
  };
}
