import { clockAttendanceResult, type ClockAttendanceResult } from '@pospay/contracts';

import { call, type Failure } from '@/shared/api/call';
import { staffApiClient } from '@/shared/api/client';

/** نتيجة مسح الكارت كما تعرضها شاشة الاستقبال؛ الرفض لا يحمل تفاصيل عن موظف. */
export type CardClockOutcome =
  | { kind: 'accepted'; result: ClockAttendanceResult }
  | { kind: 'refused' }
  | { kind: 'signed-out' }
  | { kind: 'invalid' }
  | { kind: 'limited'; retryAfter?: number }
  | { kind: 'offline' }
  | { kind: 'unavailable' };

// الحضور بالكارت online-only: لا طابور ولا تخزين محلي للمسح، مثل مسح الموظف بpasskey.
export async function clockByCard(
  cardCode: string,
  signal: AbortSignal,
): Promise<CardClockOutcome> {
  if (!navigator.onLine) return { kind: 'offline' };
  const outcome = await call(() =>
    staffApiClient().POST('/v1/devices/me/clock-by-card', {
      body: { card_code: cardCode },
      signal,
      cache: 'no-store',
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    }),
  );
  if (!outcome.ok) {
    if (outcome.failure.kind === 'network') return { kind: 'unavailable' };
    return mapped(outcome.failure);
  }
  return { kind: 'accepted', result: clockAttendanceResult.parse(outcome.data) };
}

function mapped(failure: Extract<Failure, { kind: 'http' }>): CardClockOutcome {
  if (failure.status === 401) return { kind: 'signed-out' };
  if (failure.status === 403) return { kind: 'refused' };
  if (failure.status === 400 || failure.status === 404 || failure.status === 422) {
    return { kind: 'invalid' };
  }
  if (failure.status !== 429) return { kind: 'unavailable' };
  return failure.retryAfter === undefined
    ? { kind: 'limited' }
    : { kind: 'limited', retryAfter: failure.retryAfter };
}
