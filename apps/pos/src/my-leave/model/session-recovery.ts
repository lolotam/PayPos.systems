import type { LeaveContext } from './context';

export type RecoverLeaveSession = (
  context: LeaveContext,
  branch: string,
  signal: AbortSignal,
) => Promise<string>;
