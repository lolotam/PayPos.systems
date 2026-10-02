import type { Redis } from 'ioredis';

import type { SendAdmission } from '../ports/send-admission.port.ts';

const RESERVE = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
if ARGV[2] ~= '' and now >= tonumber(ARGV[2]) then return 0 end
return redis.call('SET', KEYS[1], 'reserved', 'PX', ARGV[1], 'NX') and 1 or 0`;

export function redisSendAdmission(redis: Redis, intervalMs: number): SendAdmission {
  // ADR-0019 يربط OTP عند 1000 ms على مفتاح الهوية نفسه لإرسال الشركات.
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1)
    throw new Error('NOTIFICATION_ADMISSION_CONFIG_INVALID');
  return {
    reserve: async (hash, deadline) => {
      const key = `notifications:admission:${Buffer.from(hash).toString('hex')}`;
      try {
        return (await redis.eval(RESERVE, 1, key, intervalMs, deadline?.getTime() ?? '')) === 1;
      } catch {
        throw new Error('NOTIFICATION_ADMISSION_UNAVAILABLE');
      }
    },
  };
}
