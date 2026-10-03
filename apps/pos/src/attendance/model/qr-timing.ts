import type { AttendanceQrIssue } from '@pospay/contracts';

export interface ReceivedQr {
  readonly issue: AttendanceQrIssue;
  readonly requestedMono: number;
  readonly receivedMono: number;
  readonly receivedWall: number;
  readonly serverAtReceipt: number;
}

export function receivedQr(
  issue: AttendanceQrIssue,
  started: number,
  ended: number,
  wall: number,
): ReceivedQr {
  return {
    issue,
    requestedMono: started,
    receivedMono: ended,
    receivedWall: wall,
    serverAtReceipt: Date.parse(issue.server_time) + Math.max(0, ended - started),
  };
}

export function qrServerTime(received: ReceivedQr, mono: number, wall: number): number {
  // الساعة المحلية ممكن تتغير؛ الأكبر بيمنع إطالة صلاحية الرمز بعد النوم أو تعديل الساعة للخلف.
  return (
    received.serverAtReceipt +
    Math.max(0, mono - received.receivedMono, wall - received.receivedWall)
  );
}

export function qrRefreshDelay(received: ReceivedQr, mono: number, wall: number): number {
  return Math.max(0, Date.parse(received.issue.refresh_at) - qrServerTime(received, mono, wall));
}

export function qrPayload(
  received: ReceivedQr | undefined,
  branchId: string,
  mono: number,
  wall: number,
): string | null {
  if (
    received === undefined ||
    received.issue.token.branch_id !== branchId ||
    received.issue.branch.id !== branchId
  )
    return null;
  if (qrRefreshDelay(received, mono, wall) === 0) return null;
  return JSON.stringify(received.issue.token);
}
