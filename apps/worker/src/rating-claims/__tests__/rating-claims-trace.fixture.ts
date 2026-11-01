// خطافات حالة الجدولة: بتوقف عند أمر معروف، أو بتطويّقه قبله، أو بتضيّع رده بعده.
// وفيها تشخيص بيسجّل كل ما بلّغه الدور، عشان الاختبار يقرأ الأرقام مش النداءات.
import type {
  ClaimStateFence,
  RatingClaimState,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
import type {
  RatingClaimDiagnostics,
  RatingClaimsOverflowReport,
} from '../../modules/customers/ports/rating-claim-diagnostics.port.ts';
import type { RatingClaimsTurnSummary } from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';

/** بوابة بوعدين: بتوقف الاستدعاء عند خطوة معروفة، والاختبار هو اللي بيفتحها. */
export interface Gate {
  /** بيتحل لما الاستدعاء يوصل البوابة فعلاً. */
  readonly acquired: Promise<void>;
  markAcquired(): void;
  release(): void;
  wait(): Promise<void>;
}

export function createGate(): Gate {
  let markAcquired!: () => void;
  let release!: () => void;
  const acquired = new Promise<void>((resolve) => {
    markAcquired = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    acquired,
    markAcquired: () => markAcquired(),
    release: () => release(),
    wait: () => released,
  };
}

/** أثر أوامر حالة الجدولة: الأوامر اللي اتبعت بسورها، والصفحات اللي اتسجلت. */
export interface StateTrace {
  readonly calls: { readonly method: string; readonly fence: ClaimStateFence }[];
  readonly pages: {
    readonly pageId: string;
    readonly requestIds: readonly string[];
    readonly workTokens: readonly string[];
  }[];
}

/** منفذ حالة بخطافات: بيوقف عند طريقة، أو بيطيح قبلها، أو بيضيّع الرد بعدها. */
export interface TracedState {
  readonly port: RatingClaimState;
  readonly trace: StateTrace;
  /** بوابة توقف الاستدعاء عند الطريقة دي قبل تنفيذها. */
  hold(method: string): Gate;
  /** الانهيار بيحصل قبل تنفيذ الأمر، فالأمر ماتنفّذش. */
  crashBefore(method: string): void;
  /** الرد بيروح بعد تنفيذ الأمر: التنفيذ حصل والعميل ما عرفش. */
  loseReply(method: string): void;
}

/** تشخيص بيسجّل كل ما بلّغه الدور، عشان الاختبار يقرأ الأرقام مش النداءات. */
export interface RecordingDiagnostics extends RatingClaimDiagnostics {
  readonly overflows: RatingClaimsOverflowReport[];
  readonly fenceLosses: string[];
  readonly failures: unknown[];
  readonly summaries: RatingClaimsTurnSummary[];
}

/** تشخيص بيسجّل كل بلاغات الدور في قوائم مفتوحة. */
export function recordingDiagnostics(): RecordingDiagnostics {
  const overflows: RatingClaimsOverflowReport[] = [];
  const fenceLosses: string[] = [];
  const failures: unknown[] = [];
  const summaries: RatingClaimsTurnSummary[] = [];
  return {
    overflows,
    fenceLosses,
    failures,
    summaries,
    failed: (_companyId, error) => {
      failures.push(error);
    },
    overflow: (_companyId, report) => {
      overflows.push(report);
    },
    fenceLost: (_companyId, code) => {
      fenceLosses.push(code);
    },
    turnSummary: (_companyId, summary) => {
      summaries.push(summary);
    },
  };
}

/** الخطافات المعلّقة على منفذ الحالة. */
interface TraceHooks {
  readonly trace: StateTrace;
  readonly gates: Map<string, Gate>;
  readonly crashing: Set<string>;
  readonly lost: Set<string>;
}

/**
 * نداء واحد على منفذ الحالة بخطافاته: يسجّل السور، ويفحص الانهيار والبوابة
 * والضياع بالترتيب اللي بيحصل فيه في Worker الحقيقي.
 */
async function hookedCall<T>(
  hooks: TraceHooks,
  method: string,
  fence: ClaimStateFence | null,
  work: () => Promise<T>,
): Promise<T> {
  if (fence !== null) hooks.trace.calls.push({ method, fence: { ...fence } });
  if (hooks.crashing.has(method)) {
    hooks.crashing.delete(method);
    throw new Error(`RATING_CLAIM_STATE_CRASH:${method}`);
  }
  const gate = hooks.gates.get(method);
  if (gate !== undefined) {
    gate.markAcquired();
    await gate.wait();
  }
  const result = await work();
  if (hooks.lost.has(method)) {
    hooks.lost.delete(method);
    throw new Error(`RATING_CLAIM_STATE_REPLY_LOST:${method}`);
  }
  return result;
}

/** منفذ الحالة الحقيقي مغلّف بخطافات الاختبار. */
function tracedPort(real: RatingClaimState, hooks: TraceHooks): RatingClaimState {
  const call = <T>(method: string, fence: ClaimStateFence | null, work: () => Promise<T>) =>
    hookedCall(hooks, method, fence, work);
  return {
    acquire: (companyId, newIncarnation, ownerToken) =>
      real.acquire(companyId, newIncarnation, ownerToken),
    renew: (fence) => call('renew', fence, () => real.renew(fence)),
    release: (fence) => call('release', fence, () => real.release(fence)),
    begin: (fence, sweepId, upperId) =>
      call('begin', fence, () => real.begin(fence, sweepId, upperId)),
    enrollPage: (fence, sweepId, fromId, pageId, entries, exhausted, maxEntries) => {
      hooks.trace.pages.push({
        pageId,
        requestIds: entries.map((entry) => entry.requestId),
        workTokens: entries.map((entry) => entry.workToken),
      });
      return call('enrollPage', fence, () =>
        real.enrollPage(fence, sweepId, fromId, pageId, entries, exhausted, maxEntries),
      );
    },
    reserveRetries: (fence, limit, workTokens) =>
      call('reserveRetries', fence, () => real.reserveRetries(fence, limit, workTokens)),
    settlePage: (fence, pageId, workToken, settlement, storedDueAt) =>
      call('settlePage', fence, () =>
        real.settlePage(fence, pageId, workToken, settlement, storedDueAt),
      ),
    settleRetry: (fence, requestId, workToken, settlement, storedDueAt) =>
      call('settleRetry', fence, () =>
        real.settleRetry(fence, requestId, workToken, settlement, storedDueAt),
      ),
    finish: (fence, sweepId) => call('finish', fence, () => real.finish(fence, sweepId)),
    read: (companyId) => real.read(companyId),
  };
}

/**
 * بيلفّ منفذ الحالة الحقيقي بخطافات الاختبار؛ كل أمر بينفّذ زي ما هو غير لما
 * الاختبار يطلب توقف أو انهيار أو ضياع رد.
 */
export function tracedState(real: RatingClaimState): TracedState {
  const hooks: TraceHooks = {
    trace: { calls: [], pages: [] },
    gates: new Map<string, Gate>(),
    crashing: new Set<string>(),
    lost: new Set<string>(),
  };
  return {
    port: tracedPort(real, hooks),
    trace: hooks.trace,
    hold: (method) => {
      const gate = createGate();
      hooks.gates.set(method, gate);
      return gate;
    },
    crashBefore: (method) => {
      hooks.crashing.add(method);
    },
    loseReply: (method) => {
      hooks.lost.add(method);
    },
  };
}
