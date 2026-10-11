import { createAddSessionKind } from './persistence/add-session-kind.ts';
import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { RequestAttendanceChangeUseCase } from './use-cases/request-attendance-change/request-attendance-change.usecase.ts';
import { CancelAttendanceChangeUseCase } from './use-cases/cancel-attendance-change/cancel-attendance-change.usecase.ts';
import { DecideAttendanceChangeUseCase } from './use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import {
  ATTENDANCE_CHANGE_KINDS,
  type AttendanceChangeKinds,
} from './ports/attendance-change-kinds.port.ts';
import { createAttendanceChangeKinds } from './persistence/attendance-change-kinds.ts';
import { createVoidSessionKind } from './persistence/void-session-kind.ts';
import { createRestoreSessionKind } from './persistence/restore-session-kind.ts';
import { createAttendanceChangeTransactions } from './persistence/drizzle-attendance-change-transactions.ts';
import { createAttendanceChangeReadAccess } from './persistence/attendance-change-context.adapter.ts';
import { ATTENDANCE_CHANGE_READ_ACCESS } from './queries/attendance-change-requests.query.ts';

export function attendanceChangeProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const transactions = (kinds: AttendanceChangeKinds) =>
    database === undefined ? null : createAttendanceChangeTransactions(database, ids, kinds);
  return [
    {
      provide: ATTENDANCE_CHANGE_KINDS,
      useValue: createAttendanceChangeKinds([
        createAddSessionKind(ids),
        createVoidSessionKind(ids),
        createRestoreSessionKind(ids),
      ]),
    },
    {
      provide: ATTENDANCE_CHANGE_READ_ACCESS,
      useValue: createAttendanceChangeReadAccess(systemClock),
    },
    {
      provide: CancelAttendanceChangeUseCase,
      inject: [ATTENDANCE_CHANGE_KINDS],
      useFactory: (kinds: AttendanceChangeKinds) => {
        const tx = transactions(kinds);
        return tx === null ? null : new CancelAttendanceChangeUseCase(tx, systemClock);
      },
    },
    {
      provide: RequestAttendanceChangeUseCase,
      inject: [ATTENDANCE_CHANGE_KINDS],
      useFactory: (kinds: AttendanceChangeKinds) => {
        const tx = transactions(kinds);
        return tx === null ? null : new RequestAttendanceChangeUseCase(tx, systemClock, kinds, ids);
      },
    },
    {
      provide: DecideAttendanceChangeUseCase,
      inject: [ATTENDANCE_CHANGE_KINDS],
      useFactory: (kinds: AttendanceChangeKinds) => {
        const tx = transactions(kinds);
        return tx === null ? null : new DecideAttendanceChangeUseCase(tx, systemClock, kinds);
      },
    },
  ];
}
