import { errorEnvelope, type ServiceSessionRecoveryPage, type ServiceSessionRecoveryVisit } from '@pospay/contracts';
import type { RecoveryConfirmOutcome } from './session-recording-result';

export type RecoveryNotice = 'NOT_YET' | 'WINDOW_ENDED';
export type RecoveryPanel =
  | { kind: 'NEVER_REACHED' }
  | { kind: 'CANNOT_VERIFY' }
  | { kind: 'NOT_YET'; opensAt: string | null }
  | { kind: 'WINDOW_ENDED' }
  | {
    kind: 'LIST'; visits: ServiceSessionRecoveryVisit[]; nextCursor: string | null;
    outcome?: 'COMMITTED' | 'NOT_COMMITTED'; notice?: RecoveryNotice; opensAt?: string;
    businessDate: string; businessTimezone: string;
  };

type ReadFailure = { code: string; details: unknown };

function readFailure(error: unknown): ReadFailure | null {
  const parsed = errorEnvelope.safeParse(error);
  return parsed.success ? { code: parsed.data.code, details: parsed.data.details } : null;
}
function opensAt(details: unknown): string | null {
  if (!details || typeof details !== 'object' || !('opens_at' in details)) return null;
  return typeof details.opens_at === 'string' ? details.opens_at : null;
}
function terminal(failure: ReadFailure | null): RecoveryPanel {
  if (failure?.code === 'SESSION_RECOVERY_NOT_FOUND') return { kind: 'NEVER_REACHED' };
  if (failure?.code === 'SESSION_RECOVERY_NOT_YET') return { kind: 'NOT_YET', opensAt: opensAt(failure.details) };
  if (failure?.code === 'SESSION_RECOVERY_CLOSED') return { kind: 'WINDOW_ENDED' };
  return { kind: 'CANNOT_VERIFY' };
}
// من غير lastSentAt مفيش قراءة (#210). صفحة «المزيد» لو رجعت CLOSED أو NOT_YET تسيب الزيارات المحمّلة وتظهر الحالة تحتها (#224).
function listFrom(pages: ServiceSessionRecoveryPage[], failure: ReadFailure | null, morePageFailed: boolean): RecoveryPanel {
  const first = pages[0];
  if (!first) return { kind: 'CANNOT_VERIFY' };
  const outcome = first.attempt.outcome;
  const list: RecoveryPanel = {
    kind: 'LIST', visits: pages.flatMap((page) => page.items), nextCursor: pages.at(-1)?.next_cursor ?? null,
    businessDate: first.attempt.business_date, businessTimezone: first.attempt.business_timezone, ...(outcome ? { outcome } : {}),
  };
  if (!morePageFailed || !failure) return list;
  if (failure.code === 'SESSION_RECOVERY_CLOSED') return { ...list, nextCursor: null, notice: 'WINDOW_ENDED' };
  if (failure.code === 'SESSION_RECOVERY_NOT_YET') {
    const when = opensAt(failure.details);
    return { ...list, nextCursor: null, notice: 'NOT_YET', ...(when ? { opensAt: when } : {}) };
  }
  return list;
}

export function recoveryPanelFromRead(input: { lastSentAt: number | undefined; pages: ServiceSessionRecoveryPage[]; error: unknown; morePageFailed: boolean }): RecoveryPanel | null {
  if (input.lastSentAt === undefined) return { kind: 'NEVER_REACHED' };
  const failure = readFailure(input.error);
  if (input.pages.length > 0) return listFrom(input.pages, failure, input.morePageFailed);
  if (!input.error) return null;
  return terminal(failure);
}

export function suggestedRecoveryConfirmation(panel: RecoveryPanel | null): RecoveryConfirmOutcome | null {
  if (panel?.kind !== 'LIST') return null;
  if (panel.outcome === 'COMMITTED') return 'RECORDED_ELSEWHERE';
  if (panel.outcome === 'NOT_COMMITTED') return 'NOT_RECORDED';
  return null;
}
