import type { Redis } from 'ioredis';
const SLOWLOG_LIMIT = 128;
/** يُسقط كل صف إلى أول ثلاثة حقول رقمية غير السالبة المحدودة فقط؛ أي شكل سيئ يرفض الكل بلا صد أي حقل خام. */
export function projectSlowlogRows(reply: unknown): Array<[number, number, number]> | undefined {
  if (!Array.isArray(reply)) return undefined;
  const rows: Array<[number, number, number]> = [];
  for (const row of reply) {
    if (!Array.isArray(row) || row.length < 3) return undefined;
    const [id, seconds, micros] = row;
    const bad = (v: unknown) => typeof v !== 'number' || !Number.isFinite(v) || v < 0;
    if (bad(id) || bad(seconds) || bad(micros)) return undefined;
    rows.push([id, seconds, micros]);
  }
  return rows;
}
export async function createRatingCiProfiler(redis: Pick<Redis, 'slowlog'>) {
  const ci = process.env['CI'];
  if (!['true', '1'].includes(ci ?? '') || process.env['POSPAY_RATING_CI_PROFILE'] !== '1')
    return undefined;
  const records: Array<Record<'variant' | 'block' | 'call' | 'elapsedMs' | 'end', number>> = [];
  let lastId = Number.NaN;
  try {
    const baseline = projectSlowlogRows(await redis.slowlog('GET', SLOWLOG_LIMIT));
    if (baseline === undefined) throw new Error('SLOWLOG_BASELINE');
    lastId = Math.max(...baseline.map((row) => row[0]), -1);
  } catch {
    // فشل خط الأساس تشخيصي فقط؛ أول flush ناجح يعيد الربط ويبقي coverage غير متاح.
  }
  const flush = async (): Promise<void> => {
    let slowlog: Record<string, unknown>;
    try {
      const rows = projectSlowlogRows(await redis.slowlog('GET', SLOWLOG_LIMIT));
      if (rows === undefined) throw new Error('SLOWLOG_INVALID');
      const highest = rows.length > 0 ? Math.max(...rows.map((row) => row[0])) : -1;
      if (Number.isNaN(lastId)) {
        lastId = highest;
        slowlog = { slowlog: 'rebaseline', coverage: 'invalidated-before' };
      } else if (highest < lastId) {
        lastId = Number.NaN;
        slowlog = { slowlog: 'unavailable', reason: 'id-reset' };
      } else {
        const fresh = rows.filter((row) => row[0] > lastId);
        const missing = highest - lastId - fresh.length;
        lastId = Math.max(highest, lastId);
        slowlog = { slowlog: fresh, missing, label: 'block-associated Redis activity' };
      }
    } catch {
      lastId = Number.NaN;
      slowlog = { slowlog: 'unavailable', coverage: 'invalidated' };
    }
    console.log(
      JSON.stringify({ scenario: 'rating-ci-profile', records: records.splice(0), ...slowlog }),
    );
  };
  return {
    sample: (variant: number, block: number, call: number, elapsedMs: number) => {
      records.push({ variant, block, call, elapsedMs, end: Date.now() });
    },
    flush,
  };
}
