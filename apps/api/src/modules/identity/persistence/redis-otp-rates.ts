import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';
import { OTP_RETRY_MS, type OtpRates } from '@pospay/auth';

const ADMIT = `
local t = redis.call('TIME')
local now = t[1]*1000 + math.floor(t[2]/1000)
local hour = 3600000
local cooldown = tonumber(ARGV[1])
local phoneLimit = tonumber(ARGV[2])
local ipLimit = tonumber(ARGV[3])
local usePhone = ARGV[4] == '1'
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now-hour)
if usePhone then redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-hour) end
local retry = 0
local function quota(key,limit)
  if redis.call('ZCARD',key) >= limit then
    local first = redis.call('ZRANGE',key,0,0,'WITHSCORES')
    return math.max(1,math.ceil((tonumber(first[2])+hour-now)/1000))
  end
  return 0
end
retry = quota(KEYS[2],ipLimit)
if usePhone then retry = math.max(retry,quota(KEYS[1],phoneLimit)) end
if usePhone and cooldown > 0 then
  local last = redis.call('GET',KEYS[3])
  if last then retry = math.max(retry,math.ceil((tonumber(last)+cooldown-now)/1000)) end
end
if retry > 0 then return retry end
if ARGV[6] ~= '' then redis.call('SET',KEYS[4],ARGV[6],'PX',hour,'NX') end
local member = tostring(now)..':'..ARGV[5]
redis.call('ZADD',KEYS[2],now,member)
redis.call('PEXPIRE',KEYS[2],hour)
if usePhone then
  redis.call('ZADD',KEYS[1],now,member)
  redis.call('PEXPIRE',KEYS[1],hour)
  if cooldown > 0 then redis.call('SET',KEYS[3],now,'PX',cooldown) end
end
return 0`;

export function redisOtpRates(redis: Redis, hashKey: string, ids: { newId(): string }): OtpRates {
  const reserve = async (input: {
    operation: 'request' | 'verify';
    phone: string;
    ip: string;
    challengeId?: string;
  }) => {
    const { operation, phone, ip, challengeId } = input;
    const network = createHmac('sha256', hashKey)
      .update('pospay:staff-otp:ip:v1\0')
      .update(ip)
      .digest('hex');
    return Number(
      await redis.eval(
        ADMIT,
        4,
        `staff-otp:${operation}:phone:${phone}`,
        `staff-otp:${operation}:ip:${network}`,
        `staff-otp:cooldown:${phone}`,
        `staff-otp:proof:${challengeId?.toLowerCase() ?? ''}`,
        operation === 'request' ? OTP_RETRY_MS : 0,
        operation === 'request' ? 5 : 25,
        operation === 'request' ? 20 : 100,
        1,
        ids.newId(),
        operation === 'request' ? phone : '',
      ),
    );
  };
  return {
    request: (hash, ip, challengeId) =>
      reserve({ operation: 'request', phone: Buffer.from(hash).toString('hex'), ip, challengeId }),
    verify: async (challengeId, ip) => {
      const proof = challengeId.toLowerCase();
      const bound = await redis.get(`staff-otp:proof:${proof}`);
      const phone =
        bound ??
        createHmac('sha256', hashKey)
          .update('pospay:staff-otp:absent-proof:v1\0')
          .update(proof)
          .digest('hex');
      return reserve({ operation: 'verify', phone, ip });
    },
  };
}
