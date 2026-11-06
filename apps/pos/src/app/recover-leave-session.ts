import { personalSessionContext, staffSessionContext } from '@pospay/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { personalCalls } from '@/personal-staff/api/personal-calls';
import { probeStaffSession } from '@/staff-login/api/staff-calls';
import type { LeaveContext } from '@/my-leave/model/context';
import { LeaveHttpError } from '@/my-leave/model/read-error';
import { leaveCalls } from '@/my-leave/api/leave-calls';

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
  const { requireCurrent, advance } = recoveryFence(cache, sessionKey, signal, context);
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
  const accepted =
    parsed.success &&
    Date.parse(parsed.data.expires_at) > Date.now() &&
    ['user_id', 'company_id', 'business_id'].every(
      (key) => parsed.data[key as keyof typeof parsed.data] === context[key as keyof LeaveContext],
    );
  // قراءة قديمة قيد التنفيذ لا يجوز أن تستبدل السياق الذي تحققنا منه للتو.
  await cache.cancelQueries({ queryKey: sessionKey, exact: true }, { revert: false });
  requireCurrent();
  if (!accepted || !parsed.success || Date.parse(parsed.data.expires_at) <= Date.now()) {
    cache.setQueryData(sessionKey, null);
    throw new LeaveHttpError('UNAUTHENTICATED', 401);
  }
  // السياق الخارجي يملك مؤقت الجلسة؛ الرد الموثق يحدّثه قبل إتاحة أي بيانات إجازات.
  cache.setQueryData(sessionKey, parsed.data);
  advance();
  // تغيير الأجل أو الموظفة يعيد تركيب الشاشة من السياق الجديد، ولا يفك قفل السياق القديم.
  if (
    (context.mode === 'reception' &&
      (!context.branch_id ||
        !context.device_id ||
        !('device_id' in parsed.data) ||
        parsed.data.branch_id !== context.branch_id ||
        parsed.data.device_id !== context.device_id)) ||
    parsed.data.expires_at !== context.expires_at ||
    ('employee_id' in parsed.data && parsed.data.employee_id !== context.employee_id)
  )
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
}

function recoveryFence(
  cache: QueryClient,
  sessionKey: (string | number)[],
  signal: AbortSignal,
  context: LeaveContext,
) {
  // العداد يميز تحديثين في نفس الملّي ثانية، وهوية الـ query تمنع إحياء epoch اتشال بالخروج.
  const query = cache.getQueryCache().find({ queryKey: sessionKey, exact: true });
  const snapshot = query?.state.data as Record<string, unknown> | null | undefined;
  const fields = [
    'user_id',
    'company_id',
    'business_id',
    'expires_at',
    ...(context.mode === 'personal' ? ['employee_id'] : ['branch_id', 'device_id']),
  ];
  if (!snapshot || fields.some((field) => snapshot[field] !== context[field as keyof LeaveContext]))
    throw new DOMException('Recovery context superseded', 'AbortError');
  let revision = query?.state.dataUpdateCount;
  const requireCurrent = () => {
    if (
      signal.aborted ||
      !query ||
      cache.getQueryCache().find({ queryKey: sessionKey, exact: true }) !== query ||
      query.state.dataUpdateCount !== revision
    )
      throw new DOMException('Recovery superseded', 'AbortError');
  };
  return {
    requireCurrent,
    advance: () => {
      revision = query?.state.dataUpdateCount;
    },
  };
}
