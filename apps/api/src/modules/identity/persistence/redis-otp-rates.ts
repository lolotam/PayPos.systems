import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { OtpRates } from '@pospay/auth';

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
  const reserve = async (operation: 'request' | 'verify', hash: Uint8Array | null, ip: string) => {
    const phone = hash === null ? 'absent' : Buffer.from(hash).toString('hex');
    const network = createHmac('sha256', hashKey)
      .update('pospay:staff-otp:ip:v1\0')
      .update(ip)
      .digest('hex');
    return Number(
      await redis.eval(
        ADMIT,
        3,
        `staff-otp:${operation}:phone:${phone}`,
        `staff-otp:${operation}:ip:${network}`,
        `staff-otp:cooldown:${phone}`,
        operation === 'request' ? 60_000 : 0,
        operation === 'request' ? 5 : 25,
        operation === 'request' ? 20 : 100,
        hash === null ? 0 : 1,
        ids.newId(),
      ),
    );
  };
  return {
    request: (hash, ip) => reserve('request', hash, ip),
    verify: (hash, ip) => reserve('verify', hash, ip),
  };
}
