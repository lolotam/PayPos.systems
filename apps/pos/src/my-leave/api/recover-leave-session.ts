import { personalCalls } from '@/personal-staff/api/personal-calls';
import { probeStaffSession } from '@/staff-login/api/staff-calls';
import type { LeaveContext } from '../model/context';
import { LeaveHttpError } from '../model/read-error';
import { leaveCalls } from './leave-calls';

export async function recoverLeaveSession(
  context: LeaveContext,
  branch: string,
  signal: AbortSignal,
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
  if (signal.aborted) return;
  if (context.mode === 'personal') {
    const branches = await leaveCalls.branches(signal);
    if (branch && !branches.items.some((item) => item.id === branch))
      throw new LeaveHttpError('FORBIDDEN', 403);
  }
  if (branch) await leaveCalls.list(context.mode, branch, undefined, signal);
}
