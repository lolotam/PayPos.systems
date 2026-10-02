import { randomBytes } from 'node:crypto';

import type { Redis } from 'ioredis';

import { AttendanceQrUnavailableError, type QrSecretScope } from '../domain/attendance-qr.ts';
import type { AttendanceQrSecrets } from '../ports/attendance-qr.port.ts';

const key = (scope: QrSecretScope) =>
  `attendance-qr:${scope.companyId}:${scope.branchId}:${scope.day}`;

function checked(value: string | null): string | null {
  if (value !== null && !/^[a-f0-9]{64}$/.test(value)) throw new AttendanceQrUnavailableError();
  return value;
}

export function createRedisAttendanceQrSecrets(redis: Redis): AttendanceQrSecrets {
  return {
    async getOrCreate(scope) {
      try {
        const existing = checked(await redis.get(key(scope)));
        if (existing !== null) return existing;
        const candidate = randomBytes(32).toString('hex');
        const created = await redis.set(key(scope), candidate, 'PXAT', scope.retainUntil, 'NX');
        if (created === 'OK') return candidate;
        const winner = checked(await redis.get(key(scope)));
        if (winner === null) throw new AttendanceQrUnavailableError();
        return winner;
      } catch {
        throw new AttendanceQrUnavailableError();
      }
    },
    async read(scope) {
      try {
        return checked(await redis.get(key(scope)));
      } catch {
        throw new AttendanceQrUnavailableError();
      }
    },
  };
}
