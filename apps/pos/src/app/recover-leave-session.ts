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
  const session = await (context.mode === 'personal'
    ? personalCalls.session()
    : probeStaffSession());
  // نجاح جلسة مختلفة لا يعيد بيانات الهوية القديمة، حتى لو تغيّر الكوكي أثناء المحاولة.
  if (
    !session ||
    ['user_id', 'company_id', 'business_id'].some(
      (key) => session[key as keyof typeof session] !== context[key as keyof LeaveContext],
    )
  )
    throw new LeaveHttpError('UNAUTHENTICATED', 401);
  const parsed =
    context.mode === 'personal'
      ? personalSessionContext.safeParse(session)
      : staffSessionContext.safeParse(session);
  if (!parsed.success || Date.parse(parsed.data.expires_at) <= Date.now())
    throw new LeaveHttpError('UNAUTHENTICATED', 401);
  if (signal.aborted) return branch;
  const sessionKey = [
    context.mode === 'personal' ? 'personal-session' : 'staff-session',
    context.sessionEpoch,
  ];
  // قراءة قديمة قيد التنفيذ لا يجوز أن تستبدل السياق الذي تحققنا منه للتو.
  await cache.cancelQueries({ queryKey: sessionKey, exact: true });
  if (signal.aborted) return branch;
  // السياق الخارجي يملك مؤقت الجلسة؛ الرد الموثق يحدّثه قبل إتاحة أي بيانات إجازات.
  cache.setQueryData(sessionKey, parsed.data);
  // تغيير الأجل أو الموظفة يعيد تركيب الشاشة من السياق الجديد، ولا يفك قفل السياق القديم.
  if (
    parsed.data.expires_at !== context.expires_at ||
    ('employee_id' in parsed.data && parsed.data.employee_id !== context.employee_id)
  )
    throw new LeaveHttpError('UNAUTHENTICATED', 401);
  if (context.mode === 'personal') {
    const branches = await leaveCalls.branches(signal);
    if (branch && !branches.items.some((item) => item.id === branch)) return '';
  }
  if (branch) await leaveCalls.list(context.mode, branch, undefined, signal);
  return branch;
}
