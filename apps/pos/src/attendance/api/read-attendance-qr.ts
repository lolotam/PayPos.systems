import { attendanceQrIssue } from '@pospay/contracts';

import { call } from '@/shared/api/call';
import { apiClient } from '@/shared/api/client';

import { receivedQr, type ReceivedQr } from '../model/qr-timing';

export class QrRequestError extends Error {
  constructor(readonly rejected: boolean) {
    super('attendance-qr-unavailable');
  }
}

export async function readAttendanceQr(signal: AbortSignal): Promise<ReceivedQr> {
  const started = performance.now();
  const result = await call(() =>
    apiClient().POST('/v1/devices/me/attendance-qr', {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      cache: 'no-store',
    }),
  );
  if (!result.ok) {
    const rejected = result.failure.kind === 'http' && [401, 403].includes(result.failure.status);
    throw new QrRequestError(rejected);
  }
  const issue = attendanceQrIssue.parse(result.data);
  const server = Date.parse(issue.server_time);
  if (
    issue.token.window !== Math.floor(server / 60_000) ||
    Date.parse(issue.refresh_at) !== (issue.token.window + 1) * 60_000 ||
    Date.parse(issue.expires_at) !== (issue.token.window + 2) * 60_000
  ) {
    throw new QrRequestError(false);
  }
  return receivedQr(issue, started, performance.now(), Date.now());
}
