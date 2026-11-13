import type { IdGenerator } from '@pospay/db';
import type { Redis } from 'ioredis';

import {
  DEVICE_PIN_LOCK_SECONDS,
  DEVICE_PIN_MAX_FAILURES,
  DEVICE_PIN_WINDOW_SECONDS,
} from '../domain/device-pin-cap.ts';
import type { ApproverPinDevice, DevicePinCap } from '../ports/discount-approver-pin.port.ts';

// A reservation outlives a stalled or crashed request by at most this long; a comparison takes well under a second.
const ADMISSION_MS = 60_000;

// KEYS: failures, inflight (a sorted set: member = admission id, score = its deadline in ms), lock, the pending
// lock-audit marker and its short claim. Each script runs atomically, and reads Redis's clock where needed.
const NOW = `
  local t = redis.call('TIME')
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)`;
const ADMIT = `${NOW}
  if redis.call('EXISTS', KEYS[3]) == 1 then return 'locked' end
  redis.call('ZADD', KEYS[2], now + tonumber(ARGV[2]), ARGV[1])
  redis.call('PEXPIRE', KEYS[2], ARGV[2])
  return 'ok'`;
// An expired admission changes nothing: its slot was already given back, and its answer no longer counts.
const CLAIM = `${NOW}
  if redis.call('ZREM', KEYS[2], ARGV[1]) == 0 then return 'expired' end`;
// A straggler admitted before the lock must not count after it and pollute the next window.
const FAILURE = `${CLAIM}
  if redis.call('EXISTS', KEYS[3]) == 1 then return 'locked' end
  local failures = redis.call('INCR', KEYS[1])
  if failures == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
  if failures >= tonumber(ARGV[2]) then
    local locked = redis.call('SET', KEYS[3], '1', 'EX', ARGV[4], 'NX')
    redis.call('DEL', KEYS[1])
    if locked then
      redis.call('SET', KEYS[4], '1', 'EX', ARGV[4])
      return 'lockedNew'
    end
    return 'locked'
  end
  return 'failed'`;
// The lock is read again inside the same script, so a device that concurrent failures locked meanwhile wins.
const SUCCESS = `${CLAIM}
  if redis.call('EXISTS', KEYS[3]) == 1 then return 'locked' end
  return 'ok'`;
const RELEASE = `
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 'ok'`;
const CLAIM_LOCK_AUDIT = `
  if redis.call('EXISTS', KEYS[4]) == 0 then return 0 end
  local claimed = redis.call('SET', KEYS[5], '1', 'NX', 'EX', 30)
  if claimed then return 1 end
  return 0`;
const CONFIRM_LOCK_AUDIT = `
  redis.call('DEL', KEYS[4], KEYS[5])
  return 'ok'`;

const keys = (companyId: string, deviceId: string) => {
  const base = `pindev:${companyId}:${deviceId}`;
  return [
    `${base}:failures`,
    `${base}:inflight`,
    `${base}:lock`,
    `${base}:lock-audit`,
    `${base}:lock-audit-claim`,
  ];
};

/**
 * @param redis the API's Redis client
 * @param ids   the UUID v7 generator, naming each admission
 * @returns the per-device PIN cap: failures in a 15-minute window, one expiring admission per comparison in
 *          flight, and a lock with its own expiry
 */
export function createRedisDevicePinCap(redis: Redis, ids: IdGenerator): DevicePinCap {
  const run = (script: string, device: ApproverPinDevice, ...args: (string | number)[]) =>
    redis.eval(
      script,
      5,
      ...keys(device.companyId, device.deviceId),
      ...args,
    ) as Promise<string | number>;
  return {
    admit: async (device) => {
      const admission = ids.newId();
      const answer = await run(ADMIT, device, admission, ADMISSION_MS);
      return answer === 'ok' ? { kind: 'ok', admission } : { kind: 'locked' };
    },
    failure: async (device, admission) =>
      (await run(
        FAILURE,
        device,
        admission,
        DEVICE_PIN_MAX_FAILURES,
        DEVICE_PIN_WINDOW_SECONDS,
        DEVICE_PIN_LOCK_SECONDS,
      )) as 'failed' | 'locked' | 'lockedNew' | 'expired',
    success: async (device, admission) =>
      (await run(SUCCESS, device, admission)) as 'ok' | 'locked' | 'expired',
    claimLockAudit: async (device) => (await run(CLAIM_LOCK_AUDIT, device)) === 1,
    confirmLockAudit: async (device) => {
      await run(CONFIRM_LOCK_AUDIT, device);
    },
    release: async (device, admission) => {
      await run(RELEASE, device, admission);
    },
  };
}
