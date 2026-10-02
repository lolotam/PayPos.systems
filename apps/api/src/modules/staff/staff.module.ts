import type { Provider } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import { AttendanceQrController } from './http/attendance-qr.controller.ts';
import { hmacAttendanceQr } from './persistence/hmac-attendance-qr.ts';
import { createRedisAttendanceQrSecrets } from './persistence/redis-attendance-qr-secrets.ts';
import { createAttendanceBranchReader } from './persistence/tenancy-attendance-branch.adapter.ts';
import { IssueAttendanceQr } from './use-cases/issue-attendance-qr/issue-attendance-qr.ts';
import { VerifyAttendanceQr } from './use-cases/verify-attendance-qr/verify-attendance-qr.ts';

export const staffControllers = [AttendanceQrController];

export function staffProviders(database?: TenantWrappers, redis?: Redis): Provider[] {
  const secrets = redis === undefined ? null : createRedisAttendanceQrSecrets(redis);
  const branches = database === undefined ? null : createAttendanceBranchReader(database);
  return [
    {
      provide: IssueAttendanceQr,
      useValue:
        branches === null || secrets === null
          ? null
          : new IssueAttendanceQr(branches, secrets, hmacAttendanceQr, systemClock),
    },
    {
      provide: VerifyAttendanceQr,
      useValue:
        secrets === null ? null : new VerifyAttendanceQr(secrets, hmacAttendanceQr, systemClock),
    },
  ];
}
