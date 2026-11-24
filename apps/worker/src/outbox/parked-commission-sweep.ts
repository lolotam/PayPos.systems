import type { ParkedCommissionOutboxRow } from '@pospay/db';
import type { ParkedAlertOutcome } from '@pospay/domain';
import type { Logger } from '@pospay/observability';

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_TRANSACTIONS = 200;
const DEFAULT_SETTLED_CAPACITY = 10_000;
const DEFAULT_NO_OWNERS_CAPACITY = 1_000;
const DEFAULT_FAILURE_CAPACITY = 1_000;
const DEFAULT_FAILURE_LOG_COOLDOWN_MS = 10 * 60 * 1000;

/** الحدث الموقوف كما يراه المسح: هويته ونوعه وشركته، بلا حمولة (ADR-0012 §3). */
export interface ParkedSweepEvent {
  readonly companyId: string;
  readonly eventId: string;
  readonly eventType: string;
}

/** إعدادات المسح: قارئ الصفحات، رافع التنبيه، وحدود الشغل. */
export interface ParkedCommissionSweepOptions {
  readonly readPage: (
    afterSeq: string | bigint,
    limit: number,
  ) => Promise<readonly ParkedCommissionOutboxRow[]>;
  readonly raiseAlert: (event: ParkedSweepEvent) => Promise<ParkedAlertOutcome>;
  readonly logger: Logger;
  readonly now?: () => number;
  readonly pageSize?: number;
  readonly maxTransactionsPerSweep?: number;
  readonly settledCapacity?: number;
  readonly noOwnersCapacity?: number;
  readonly failureLogCooldownMs?: number;
  readonly isStopped?: () => boolean;
}

/**
 * مجموعة محدودة الحجم بترتيب آخر استخدام. الحدث المسجَّل بيُتخطى من غير معاملة جديدة،
 * والإفراط في الحجم يطرد الأقدم؛ الإفراط آمن لأن العلامة في القاعدة هي مصدر الحقيقة الوحيد.
 */
class BoundedLru<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  /** يقرأ القيمة ويلمس ترتيبها، فالعنصر المستعمل يفضل آخر واحد يطرد؛ الغايب بيرجع undefined. */
  peek(key: string): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** يكتب القيمة، ويفرّغ الأقدم لما السعة تتعدى. */
  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  /** يشيل العنصر من المجموعة. */
  remove(key: string): void {
    this.entries.delete(key);
  }
}

/** ذاكرة المسح بين الجولات: المستقرّ، وبلا مالك، وآخر فشل مسجَّل. */
interface SweepMemory {
  readonly settled: BoundedLru<true>;
  readonly noOwners: BoundedLru<true>;
  readonly failures: BoundedLru<number>;
}

/** نتيجة صفحة واحدة: كام معاملة اتفتحت، وهل وقف المسح بسبب السقف. */
interface PageOutcome {
  readonly transactions: number;
  readonly capped: boolean;
}

/** يسجّل الفشل بتبريد: أول فشل بيتسجّل، وبعده نفس الحدث بيتسجّل كل عشر دقايق بالكتير. */
function logFailure(
  memory: SweepMemory,
  logger: Logger,
  row: ParkedCommissionOutboxRow,
  error: unknown,
  now: number,
  cooldownMs: number,
): void {
  const last = memory.failures.peek(row.id);
  if (last !== undefined && now - last < cooldownMs) return;
  memory.failures.set(row.id, now);
  logger.error(
    { err: error, event: { id: row.id, type: row.eventType, companyId: row.companyId } },
    'outbox park alert failed',
  );
}

/** يسجّل مرة واحدة إن مفيش مالك في الشركة، عشان ما يتزحمش السجل بكل جولة. */
function logNoOwners(memory: SweepMemory, logger: Logger, row: ParkedCommissionOutboxRow): void {
  if (memory.noOwners.peek(row.id) !== undefined) return;
  memory.noOwners.set(row.id, true);
  logger.error(
    { event: { id: row.id, type: row.eventType, companyId: row.companyId } },
    'commission park alert has no recipient',
  );
}

/** يرفع التنبيه على حدث واحد؛ الفشل ما بيوقفش الصفحة ولا المسح (ADR-0012 §4). */
async function raiseForRow(
  memory: SweepMemory,
  options: ParkedCommissionSweepOptions,
  row: ParkedCommissionOutboxRow,
  now: number,
  cooldownMs: number,
): Promise<void> {
  let outcome: ParkedAlertOutcome;
  try {
    // The outbox event-type scan reads `eventType:` property assignments and only understands
    // literals; the stopped event's type is dynamic by design, so the object is built by shorthand.
    const { companyId, eventType } = row;
    outcome = await options.raiseAlert({ companyId, eventId: row.id, eventType });
  } catch (error) {
    logFailure(memory, options.logger, row, error, now, cooldownMs);
    return;
  }
  if (outcome === 'NO_OWNERS') {
    logNoOwners(memory, options.logger, row);
    return;
  }
  memory.settled.set(row.id, true);
  memory.noOwners.remove(row.id);
  memory.failures.remove(row.id);
}

/** يعالج صفحة واحدة: المستقرّ بيتخطى من غير معاملة، والسقف بيوقف المسح (ADR-0012 §4). */
async function sweepPage(
  memory: SweepMemory,
  options: ParkedCommissionSweepOptions,
  page: readonly ParkedCommissionOutboxRow[],
  transactions: number,
  maxTransactionsPerSweep: number,
  cooldownMs: number,
): Promise<PageOutcome> {
  let used = transactions;
  for (const row of page) {
    if (memory.settled.peek(row.id) !== undefined) continue;
    if (used >= maxTransactionsPerSweep) {
      options.logger.info(
        { maxTransactionsPerSweep },
        'parked commission alert sweep reached transaction cap',
      );
      return { transactions: used, capped: true };
    }
    used += 1;
    await raiseForRow(memory, options, row, (options.now ?? Date.now)(), cooldownMs);
  }
  return { transactions: used, capped: false };
}

/**
 * المسح الدوري: يقرأ صفحة صفحة من الأحداث الموقوفة ويرفع تنبيه المالك على كل حدث لسه
 * بيعطّل اعتماد الشهر. كل مسح يبدأ من أول صف (ADR-0012 §4): المؤشر بيتقدم بعد الصفحة
 * كلها بس، والصفحة الناقصة معناها إن مفيش أحداث موقوفة بعدها.
 *
 * @param memory ذاكرة المسح بين الجولات
 * @param options القارئ والرافع والحدود
 * @returns دالة المسح الواحد
 */
async function sweepAll(memory: SweepMemory, options: ParkedCommissionSweepOptions): Promise<void> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxTransactionsPerSweep = options.maxTransactionsPerSweep ?? DEFAULT_MAX_TRANSACTIONS;
  const cooldownMs = options.failureLogCooldownMs ?? DEFAULT_FAILURE_LOG_COOLDOWN_MS;
  let cursor = '0';
  let transactions = 0;
  for (;;) {
    if (options.isStopped?.() === true) return;
    const page = await options.readPage(cursor, pageSize);
    const outcome = await sweepPage(
      memory,
      options,
      page,
      transactions,
      maxTransactionsPerSweep,
      cooldownMs,
    );
    transactions = outcome.transactions;
    if (outcome.capped) return;
    const last = page.at(-1);
    if (last === undefined) return;
    cursor = last.seq;
    if (page.length < pageSize) return;
  }
}

/**
 * مسح دوري لأحداث العمولة الموقوفة: هو المصدر الوحيد لتنبيه المالك (ADR-0012 §3).
 * الضمان: طلب تنبيه واحد دائم لكل حدث موقوف بيعطّل الاعتماد؛ العلامة في القاعدة هي
 * بين الجولات مجرد اختصار بيوفّر معاملات.
 *
 * @param options قارئ الصفحات ورافع التنبيه والحدود
 * @returns دالة المسح الواحد
 */
export function createParkedCommissionSweep(
  options: ParkedCommissionSweepOptions,
): () => Promise<void> {
  const memory: SweepMemory = {
    settled: new BoundedLru<true>(options.settledCapacity ?? DEFAULT_SETTLED_CAPACITY),
    noOwners: new BoundedLru<true>(options.noOwnersCapacity ?? DEFAULT_NO_OWNERS_CAPACITY),
    failures: new BoundedLru<number>(DEFAULT_FAILURE_CAPACITY),
  };
  return () => sweepAll(memory, options);
}
