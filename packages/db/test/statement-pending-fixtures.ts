import { COMMISSION_INPUTS_CONSUMER_ID } from '@pospay/domain';
import type postgres from 'postgres';
import { asReplicaOwner } from './owner-cleanup.ts';

export type Tx = postgres.TransactionSql;

export const eventId = (n: number): string =>
  `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export interface SeedOptions {
  createdAt?: string;
  publishedAt?: string | null;
  parked?: boolean;
  attempts?: number;
  lastError?: string | null;
  nextAttemptAt?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
}

/**
 * أدوات مشتركة لاختبارات عدّاد الأحداث المعلّقة (ADR-0012): تحصل على الاتصالين وقت الاستدعاء لأنهما يُنشآن في beforeAll.
 *
 * @param getOwner اتصال مالك الـ migration الذي يزرع الصفوف ويقرأ الكتالوج
 * @param getApp   اتصال pospay_app الذي تُستدعى منه الدالة كما يفعل التطبيق
 * @returns الدوال المربوطة بالاتصالين
 */
export function pendingCountHarness(getOwner: () => postgres.Sql, getApp: () => postgres.Sql) {
  /** يشغّل معاملة كـ pospay_app بسياق الشركة؛ null يعني بلا سياق، كأن الاتصال رجع من الـ pool نظيفًا. */
  async function asApp<T>(company: string | null, run: (tx: Tx) => Promise<T>): Promise<T> {
    return getApp().begin(async (tx) => {
      if (company !== null) await tx`SELECT set_config('app.company_id', ${company}, true)`;
      return run(tx);
    }) as Promise<T>;
  }

  /**
   * يقرأ توقيت المعاملة نصًا بلا فقد دقة ثم يستدعي العدّاد به، كما يجب أن يفعل محوّل الاعتماد.
   * المعامل نصّ ثم يُحوَّل في SQL: معامل من نوع timestamptz يمرّ في السائق عبر Date فيقص الميكروثواني.
   */
  async function pending(tx: Tx, cutoff?: string | null): Promise<string> {
    const [clock] = await tx`SELECT transaction_timestamp()::text AS ts`;
    const used = cutoff === undefined ? (clock?.['ts'] as string) : cutoff;
    const [row] =
      await tx`SELECT public.statement_pending_commission_events(${used}::text::timestamptz)::text AS n`;
    return row?.['n'] as string;
  }

  async function seedEvent(
    company: string,
    id: string,
    type: string,
    options: SeedOptions = {},
  ): Promise<void> {
    await getOwner()`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload,
        created_at, published_at, parked_at, attempts, last_error, next_attempt_at)
      VALUES (${company}, ${id}, 'service_session', ${options.aggregateId ?? id}, ${type},
        ${JSON.stringify(options.payload ?? {})}::jsonb, ${options.createdAt ?? '2026-01-01T00:00:00Z'}::timestamptz,
        ${options.publishedAt ?? null}, ${options.parked === true ? '2026-01-02T00:00:00Z' : null},
        ${options.attempts ?? 0}, ${options.lastError ?? null},
        coalesce(${options.nextAttemptAt ?? null}::timestamptz, now()))`;
  }

  const markEvent = (company: string, id: string, consumer = COMMISSION_INPUTS_CONSUMER_ID) =>
    getOwner()`INSERT INTO consumed_events (company_id, consumer_id, event_id) VALUES (${company}, ${consumer}, ${id})`;

  async function clean(): Promise<void> {
    await getOwner()`DELETE FROM consumed_events`;
    await asReplicaOwner(getOwner(), (tx) => tx`DELETE FROM outbox`);
  }

  return { asApp, pending, seedEvent, markEvent, clean };
}

/** يغلق اتصالي الاختبار إن أُنشئا ثم يسقط القاعدة المستنسخة في finally حتى لو فشل الإعداد قبل إنشاء الاتصالين. */
export async function closePendingCountTest(
  test: { drop(): Promise<void> } | undefined,
  owner: postgres.Sql | undefined,
  app: postgres.Sql | undefined,
): Promise<void> {
  try {
    await app?.end();
    await owner?.end();
  } finally {
    await test?.drop();
  }
}
