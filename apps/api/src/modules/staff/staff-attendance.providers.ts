import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';
import type { AttendancePasskeys } from './ports/clock-attendance.port.ts';
import { createRedisRateLimiter } from '../../shared/adapters/redis-rate-limiter.ts';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { createAttendanceTransactions } from './persistence/attendance-transactions.ts';
import { createLockedAttendanceQrVerifier } from './persistence/locked-attendance-qr.ts';
import { ClockAttendance } from './use-cases/clock-attendance/clock-attendance.ts';
import { RequestClockChallenge } from './use-cases/request-clock-challenge/request-clock-challenge.ts';
import { hmacAttendanceQr } from './persistence/hmac-attendance-qr.ts';
import { createRedisAttendanceQrSecrets } from './persistence/redis-attendance-qr-secrets.ts';
import { createAttendanceBranchReader } from './persistence/tenancy-attendance-branch.adapter.ts';
import { IssueAttendanceQr } from './use-cases/issue-attendance-qr/issue-attendance-qr.ts';
import { VerifyAttendanceQr } from './use-cases/verify-attendance-qr/verify-attendance-qr.ts';
import { operatorSessionsToken } from './http/operator-sessions.token.ts';
import { ClockByCard } from './use-cases/clock-by-card/clock-by-card.ts';
import { IssueEmployeeCard } from './use-cases/issue-employee-card/issue-employee-card.usecase.ts';
import { RevokeEmployeeCard } from './use-cases/revoke-employee-card/revoke-employee-card.usecase.ts';
import { createCardClockTransactions } from './persistence/card-clock-transactions.ts';
import { createCardIssueAttempts } from './persistence/card-issue-attempts.ts';
import { createCardScanAttempts } from './persistence/card-scan-attempts.ts';
import type { CardScanAttempts } from './ports/card-scan-attempts.port.ts';
import { createEmployeeCards } from './persistence/drizzle-employee-cards.ts';
import { createEmployeeCardHash } from './persistence/employee-card-hash.ts';
import { createEmployeeCardAccess } from './persistence/employee-card-access.adapter.ts';
import { EMPLOYEE_CARD_ACCESS } from './ports/employee-card-access.port.ts';

export function attendanceProviders(
  database: TenantWrappers | undefined,
  redis: Redis | undefined,
  passkeys: AttendancePasskeys | null,
  ids: IdGenerator,
): Provider[] {
  const secrets = redis === undefined ? null : createRedisAttendanceQrSecrets(redis);
  const branches = database === undefined ? null : createAttendanceBranchReader(database);
  const qrProviders: Provider[] = [
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
        branches === null || secrets === null
          ? null
          : new VerifyAttendanceQr(branches, secrets, hmacAttendanceQr, systemClock),
    },
  ];
  if (database === undefined || secrets === null || passkeys === null)
    return [
      ...qrProviders,
      { provide: ClockAttendance, useValue: null },
      { provide: RequestClockChallenge, useValue: null },
    ];
  const qr = createLockedAttendanceQrVerifier(secrets, hmacAttendanceQr);
  const transactions = createAttendanceTransactions(database, ids);
  return [
    ...qrProviders,
    {
      provide: ClockAttendance,
      useValue: new ClockAttendance(transactions, passkeys, qr, systemClock, ids),
    },
    {
      provide: RequestClockChallenge,
      useValue: new RequestClockChallenge(transactions, passkeys, qr, systemClock),
    },
  ];
}

export function cardProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  cardKey: Buffer | null,
  redis: Redis | undefined,
): Provider[] {
  if (database === undefined || cardKey === null)
    return [
      { provide: ClockByCard, useValue: null },
      { provide: IssueEmployeeCard, useValue: null },
      { provide: RevokeEmployeeCard, useValue: null },
      { provide: EMPLOYEE_CARD_ACCESS, useValue: null },
    ];
  const access = createEmployeeCardAccess();
  const hash = createEmployeeCardHash(cardKey);
  const cards = createEmployeeCards(database, ids, systemClock, access, hash);
  // بلا Redis الإصدار والمسح يفشلان مغلقين؛ الإلغاء ومسارا QR وpasskey خارج هذا الحد.
  const limiter = redis === undefined ? null : createRedisRateLimiter(redis);
  const attempts = limiter === null ? null : createCardIssueAttempts(limiter);
  const scans = limiter === null ? null : createCardScanAttempts(limiter);
  return [
    clockByCardProvider(database, ids, hash, scans),
    {
      provide: IssueEmployeeCard,
      useValue: attempts === null ? null : new IssueEmployeeCard(cards, attempts),
    },
    { provide: RevokeEmployeeCard, useValue: new RevokeEmployeeCard(cards) },
    { provide: EMPLOYEE_CARD_ACCESS, useValue: access },
  ];
}

function clockByCardProvider(
  database: Parameters<typeof createCardClockTransactions>[0],
  ids: Parameters<typeof createCardClockTransactions>[1],
  hash: Parameters<typeof createCardClockTransactions>[2],
  scans: CardScanAttempts | null,
): Provider {
  if (scans === null) return { provide: ClockByCard, useValue: null };
  return {
    provide: ClockByCard,
    useFactory: (sessions: Parameters<typeof createCardClockTransactions>[3]) =>
      new ClockByCard(
        createCardClockTransactions(database, ids, hash, sessions),
        systemClock,
        ids,
        scans,
      ),
    inject: [operatorSessionsToken()],
  };
}
