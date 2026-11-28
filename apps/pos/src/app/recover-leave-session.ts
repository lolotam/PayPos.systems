import { personalSessionContext, staffSessionContext } from '@pospay/contracts';
import type { QueryCacheNotifyEvent, QueryClient } from '@tanstack/react-query';
import { personalCalls } from '@/personal-staff/api/personal-calls';
import { probeStaffSession } from '@/staff-login/api/staff-calls';
import type { LeaveContext } from '@/my-leave/model/context';
import { LeaveHttpError } from '@/my-leave/model/read-error';
import { leaveCalls } from '@/my-leave/api/leave-calls';

function matchesLeaveContext(context: LeaveContext, value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const fields = [
    'user_id',
    'company_id',
    'business_id',
    'expires_at',
    ...(context.mode === 'personal' ? ['employee_id'] : ['branch_id', 'device_id']),
  ] as const;
  return !fields.some((field) => record[field] !== context[field as keyof LeaveContext]);
}

function hasValidSessionContract(context: LeaveContext, value: unknown): boolean {
  const parsed =
    context.mode === 'personal'
      ? personalSessionContext.safeParse(value)
      : staffSessionContext.safeParse(value);
  return parsed.success && Date.parse(parsed.data.expires_at) > Date.now();
}

function isMatchingNetworkPoll(
  event: QueryCacheNotifyEvent,
  query: unknown,
  context: LeaveContext,
  revision: number | undefined,
): boolean {
  if (event.type !== 'updated' || event.query !== query) return false;
  if (event.action.type !== 'success' || event.action.manual === true) return false;
  if (revision === undefined || event.query.state.dataUpdateCount !== revision + 1) return false;
  return (
    matchesLeaveContext(context, event.query.state.data) &&
    hasValidSessionContract(context, event.query.state.data)
  );
}

function isIrrelevantCacheEvent(event: QueryCacheNotifyEvent): boolean {
  if (event.type === 'observerAdded' || event.type === 'observerRemoved') return true;
  if (event.type === 'observerResultsUpdated' || event.type === 'observerOptionsUpdated')
    return true;
  if (event.type !== 'updated') return false;
  const kind = event.action.type;
  // فشل إعادة الجلب أو إلغاء cancelQueries ({ revert: false }) لا يغيّر الجلسة المؤكدة أو عداد التحديث.
  if (
    kind === 'fetch' ||
    kind === 'pause' ||
    kind === 'continue' ||
    kind === 'invalidate' ||
    kind === 'failed' ||
    kind === 'error'
  ) {
    return true;
  }
  return (
    kind === 'setState' &&
    !('data' in event.action.state) &&
    !('dataUpdateCount' in event.action.state)
  );
}

function subscribeToFenceEvents(
  cache: QueryClient,
  query: { state: { dataUpdateCount: number } },
  context: LeaveContext,
  state: { revision: number; invalidated: boolean; selfPublishing: boolean },
  invalidate: () => void,
) {
  return cache.getQueryCache().subscribe((event) => {
    if (event.query !== query || state.invalidated) return;
    if (event.type === 'removed') {
      invalidate();
      return;
    }
    if (isIrrelevantCacheEvent(event)) return;
    if (event.type === 'updated' && event.action.type === 'success' && state.selfPublishing) {
      state.revision = query.state.dataUpdateCount;
      return;
    }
    if (isMatchingNetworkPoll(event, query, context, state.revision)) {
      state.revision = query.state.dataUpdateCount;
      return;
    }
    invalidate();
  });
}

function recoveryFence(
  cache: QueryClient,
  sessionKey: (string | number)[],
  signal: AbortSignal,
  context: LeaveContext,
) {
  // العداد يميز تحديثين في نفس الملّي ثانية، والاشتراك يكشف ABA ويميز poll الشبكة المطابق من التعديل اليدوي.
  const query = cache.getQueryCache().find({ queryKey: sessionKey, exact: true });
  if (signal.aborted || !query || !matchesLeaveContext(context, query.state.data)) {
    throw new DOMException('Recovery context superseded', 'AbortError');
  }
  const state = {
    revision: query.state.dataUpdateCount,
    invalidated: false,
    selfPublishing: false,
  };
  let disposed = false;
  let unsubscribe: () => void = () => undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    signal.removeEventListener('abort', invalidate);
  };
  const invalidate = () => {
    state.invalidated = true;
    dispose();
  };
  unsubscribe = subscribeToFenceEvents(cache, query, context, state, invalidate);
  signal.addEventListener('abort', invalidate, { once: true });
  const requireCurrent = () => {
    if (
      state.invalidated ||
      signal.aborted ||
      cache.getQueryCache().find({ queryKey: sessionKey, exact: true }) !== query ||
      query.state.dataUpdateCount !== state.revision
    ) {
      dispose();
      throw new DOMException('Recovery superseded', 'AbortError');
    }
  };
  const publish = (nextData: unknown) => {
    state.selfPublishing = true;
    try {
      cache.setQueryData(sessionKey, nextData);
    } finally {
      state.selfPublishing = false;
    }
  };
  return { requireCurrent, publish, dispose };
}

function outerIdentityMatches(
  context: LeaveContext,
  data: { user_id: string; company_id: string; business_id: string; expires_at: string },
): boolean {
  return (
    data.user_id === context.user_id &&
    data.company_id === context.company_id &&
    data.business_id === context.business_id &&
    Date.parse(data.expires_at) > Date.now()
  );
}

function sessionMatchesOuter(
  context: LeaveContext,
  data:
    ReturnType<typeof personalSessionContext.parse> | ReturnType<typeof staffSessionContext.parse>,
): boolean {
  if (
    context.mode === 'reception' &&
    (!context.branch_id ||
      !context.device_id ||
      !('device_id' in data) ||
      data.branch_id !== context.branch_id ||
      data.device_id !== context.device_id)
  ) {
    return false;
  }
  if (data.expires_at !== context.expires_at) return false;
  return !('employee_id' in data) || data.employee_id === context.employee_id;
}

export async function recoverLeaveSession(
  context: LeaveContext,
  branch: string,
  signal: AbortSignal,
  cache: QueryClient,
) {
  const sessionKey = [
    context.mode === 'personal' ? 'personal-session' : 'staff-session',
    context.sessionEpoch,
  ];
  const { requireCurrent, publish, dispose } = recoveryFence(cache, sessionKey, signal, context);
  try {
    requireCurrent();
    const session = await (context.mode === 'personal'
      ? personalCalls.session()
      : probeStaffSession());
    requireCurrent();
    const parsed =
      context.mode === 'personal'
        ? personalSessionContext.safeParse(session)
        : staffSessionContext.safeParse(session);
    // نجاح جلسة مختلفة لا يعيد بيانات الهوية القديمة، حتى لو تغيّر الكوكي أثناء المحاولة.
    const accepted = parsed.success && outerIdentityMatches(context, parsed.data);
    // قراءة قديمة قيد التنفيذ لا يجوز أن تستبدل السياق الذي تحققنا منه للتو.
    await cache.cancelQueries({ queryKey: sessionKey, exact: true }, { revert: false });
    requireCurrent();
    if (!accepted || !parsed.success) {
      publish(null);
      throw new LeaveHttpError('UNAUTHENTICATED', 401);
    }
    // السياق الخارجي يملك مؤقت الجلسة؛ الرد الموثق يحدّثه قبل إتاحة أي بيانات إجازات.
    publish(parsed.data);
    if (!sessionMatchesOuter(context, parsed.data))
      throw new LeaveHttpError('UNAUTHENTICATED', 401);
    if (context.mode === 'personal') {
      requireCurrent();
      const branches = await leaveCalls.branches(signal);
      requireCurrent();
      if (branch && !branches.items.some((item) => item.id === branch)) return '';
    }
    requireCurrent();
    if (branch) await leaveCalls.list(context.mode, branch, undefined, signal);
    requireCurrent();
    return branch;
  } finally {
    dispose();
  }
}
