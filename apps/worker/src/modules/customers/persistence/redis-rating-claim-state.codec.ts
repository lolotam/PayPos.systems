import type {
  ClaimStateCode,
  ClaimStateReservations,
  ClaimStateSnapshot,
} from '../ports/rating-claim-state.port.ts';

/** نتيجة السكربت بعد فك الترميز: الكود ورقم النسخة والقيمة لما يكون في قيمة. */
export interface DecodedReply {
  readonly code: ClaimStateCode;
  readonly version: number;
  readonly value?: Record<string, unknown>;
}

const CODES: readonly ClaimStateCode[] = ['OK', 'BUSY', 'STALE', 'MISSING', 'CORRUPT', 'LIMIT', 'OVERFLOW'];

function invalid(): Error {
  return new Error('RATING_CLAIM_STATE_REPLY_INVALID');
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw invalid();
  return value;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw invalid();
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw invalid();
  return value as Record<string, unknown>;
}

/**
 * cjson بيكتب الجدول الفاضي كـ `{}` مش `[]`، فالمصفوفة الفاضية بترجع كائنًا.
 * التحويل ده بيمنع رد زعلان على نتيجة صحيحة، وأي شكل تاني غير مصفوفة مرفوض.
 */
function asArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) return [];
  throw invalid();
}

/** بيحوّل الحالة المخزّنة إلى لقطة، وبيصلّح المصفوفات الفاضية اللي رجعت كائنات. */
export function decodeState(value: Record<string, unknown>): ClaimStateSnapshot {
  if (typeof value['companyId'] !== 'string' || typeof value['version'] !== 'number') throw invalid();
  if (value['phase'] !== 'IDLE' && value['phase'] !== 'SWEEP') throw invalid();
  if (typeof value['retries'] !== 'object' || value['retries'] === null) throw invalid();
  const page = value['page'];
  if (page !== undefined && page !== null) {
    const stored = record(page);
    stored['entries'] = asArray(stored['entries']);
  }
  return value as unknown as ClaimStateSnapshot;
}

/** بيحوّل حجوزات الإعادة لصيغة مصفوفة، والحجوزات الفاضية بترجع كائن فاضي. */
export function decodeReservations(value: Record<string, unknown>): ClaimStateReservations {
  const reservations = asArray(value['reservations']).map((item) => {
    const entry = record(item);
    return { requestId: text(entry['requestId']), workToken: text(entry['workToken']) };
  });
  return { reservations };
}

/** بيفك رد السكربت وبيتأكد إن كوده معروف، لأن كود غريب معناه الدالة في غير مكانها. */
export function parse(raw: unknown): DecodedReply {
  if (typeof raw !== 'string') throw invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  const reply = record(decoded);
  const code = reply['code'];
  if (typeof code !== 'string' || !CODES.includes(code as ClaimStateCode)) throw invalid();
  const version = count(reply['version']);
  const value = reply['value'];
  if (value === undefined) return { code: code as ClaimStateCode, version };
  return { code: code as ClaimStateCode, version, value: record(value) };
}
