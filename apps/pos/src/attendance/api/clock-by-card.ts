import { clockAttendanceResult, type ClockAttendanceResult } from '@pospay/contracts';

import { call } from '@/shared/api/call';
import { staffApiClient } from '@/shared/api/client';

/** نتيجة مسح الكارت كما تعرضها شاشة الاستقبال؛ الرفض لا يحمل تفاصيل عن موظف. */
export type CardClockOutcome =
  | { kind: 'accepted'; result: ClockAttendanceResult }
  | { kind: 'refused' }
  | { kind: 'signed-out' }
  | { kind: 'invalid' }
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
    if (outcome.failure.status === 401) return { kind: 'signed-out' };
    return outcome.failure.status === 403 ? { kind: 'refused' } : { kind: 'invalid' };
  }
  return { kind: 'accepted', result: clockAttendanceResult.parse(outcome.data) };
}
